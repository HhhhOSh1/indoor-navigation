import React, { useEffect, useRef, useState, useCallback } from "react";
import { Routes, Route, useParams, useNavigate } from "react-router-dom";
import jsQR from "jsqr";
import AdminPage from "./AdminPage";
import {
  MapPin,
  Navigation,
  Upload,
  QrCode,
  ChevronLeft,
  Map as MapIcon,
  ArrowRight,
  CornerUpLeft,
  CornerUpRight,
  CheckCircle2,
  Camera,
  Layers,
  Sparkles,
  Info
} from "lucide-react";
import SearchDropdown from "./SearchDropdown";
import { findPath } from "./pathfinding";
import { generateNavigationSteps, getClosestTransitionPoint } from "./navigationUtils";
import "./App.css";

const API_URL = process.env.REACT_APP_API_URL || `http://${window.location.hostname}:5000`;

// ฟังก์ชันเล่นเสียงบี๊บแบบสังเคราะห์ (Web Audio API)
const playBeepSound = () => {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // โน้ต A5
    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.12); // บี๊บยาว 120ms
  } catch (e) {
    console.warn("Web Audio API not supported or blocked", e);
  }
};
/* ---------- โมดัลสแกนเนอร์ QR Code ผ่านกล้องสด (Camera QR Scanner) ---------- */
const QRScannerModal = ({ isOpen, onClose, onScanSuccess }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const [errorMsg, setErrorMsg] = useState("");
  const onScanSuccessRef = useRef(onScanSuccess);
  useEffect(() => {
    onScanSuccessRef.current = onScanSuccess;
  }, [onScanSuccess]);
  useEffect(() => {
    const scanFrame = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const ctx = canvas.getContext("2d");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, canvas.width, canvas.height);
        if (code) {
          playBeepSound();
          const scannedText = decodeURIComponent(code.data.split("/").pop());
          if (onScanSuccessRef.current) {
            onScanSuccessRef.current(scannedText);
          }
          return;
        }
      }
      animationFrameRef.current = requestAnimationFrame(scanFrame);
    };
    const startCamera = async () => {
      try {
        setErrorMsg("");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" }
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true"); // จำเป็นสำหรับ iOS Safari
          videoRef.current.play();
          animationFrameRef.current = requestAnimationFrame(scanFrame);
        }
      } catch (err) {
        console.error(err);
        setErrorMsg("ไม่สามารถเปิดกล้องได้ กรุณาตรวจสอบสิทธิ์การเข้าถึงกล้องในอุปกรณ์ของคุณ");
      }
    };
    const stopCamera = () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isOpen]);
  if (!isOpen) return null;
  return (
    <div className="scanner-overlay animate-fade-in">
      <div className="scanner-card">
        <div className="scanner-header">
          <h3>สแกนตำแหน่งปัจจุบันของคุณ</h3>
          <button className="btn-close-scanner" onClick={onClose}>✕</button>
        </div>

        <div className="scanner-view-wrapper">
          {errorMsg ? (
            <div className="scanner-error">
              <Info size={32} />
              <p>{errorMsg}</p>
            </div>
          ) : (
            <div className="video-container">
              <video ref={videoRef} className="scanner-video" />
              <div className="scanner-laser" />
              <div className="scanner-target-box" />
            </div>
          )}
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>

        <p className="scanner-tip">จัดคิวอาร์โค้ดที่ติดอยู่หน้าห้องให้อยู่ในกรอบ</p>
      </div>
    </div>
  );
};
/* ---------- หน้าแสดงแผนที่ (Map Page) ---------- */
const MapPage = () => {
  const { roomName, startName } = useParams();
  const navigate = useNavigate(); // เพิ่มเพื่อทำปุ่มย้อนกลับ
  const canvasRef = useRef(null);
  // States
  const [startRoom, setStartRoom] = useState(null);
  const [endRoom, setEndRoom] = useState(null);
  const [path, setPath] = useState([]);
  const [navigationSteps, setNavigationSteps] = useState([]);
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);
  // navigationPhases เก็บแต่ละช่วงการเดิน: [{ floor, path }, ...]
  const [navigationPhases, setNavigationPhases] = useState([]);

  const [rooms, setRooms] = useState({});
  const [mapImage, setMapImage] = useState("");
  const [selectedFloor, setSelectedFloor] = useState(10);
  const [availableFloors, setAvailableFloors] = useState([10]);

  // แปลง mapImage (ชื่อไฟล์ หรือ URL เก่า) → URL ที่ใช้งานได้จาก host ปัจจุบัน
  const toMapUrl = (mapImage, version) => {
    if (!mapImage) return null;
    // ถ้าเป็น full URL แล้ว (Cloudinary / http) ใช้ตรงได้เลย
    if (mapImage.startsWith("http")) {
      return version ? `${mapImage}?v=${version}` : mapImage;
    }
    // ถ้าเป็นชื่อไฟล์ เช่น floor10.png
    const filename = mapImage.includes("/maps/")
      ? mapImage.split("/maps/").pop().split("?")[0]
      : mapImage.split("?")[0];
    const base = `${API_URL}/maps/${filename}`;
    return version ? `${base}?v=${version}` : base;
  };

  // floorImageMap โหลดจาก DB
  const [floorImageMap, setFloorImageMap] = useState({});

  // โหลด floors + rooms พร้อมกัน
  // availableFloors ใช้จาก floors collection เท่านั้น (ไม่ใช่จาก rooms)
  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/floors`).then(r => r.json()),
      fetch(`${API_URL}/rooms`).then(r => r.json()),
    ]).then(([floorsData, roomsData]) => {
      // สร้าง floorImageMap จาก floors collection
      const map = {};
      floorsData.forEach(f => {
        if (f.mapImage) map[f.floor] = toMapUrl(f.mapImage, f.mapVersion);
      });
      setFloorImageMap({ ...map });

      // availableFloors = เฉพาะชั้นที่มีใน floors collection เท่านั้น
      const floorNums = floorsData.map(f => f.floor).sort((a, b) => a - b);
      setAvailableFloors(floorNums);
      setSelectedFloor(floorNums[0] ?? 10);

      // rooms
      const formattedRooms = {};
      roomsData.forEach(room => {
        formattedRooms[room.name] = {
          coords: room.coords,
          floor: room.floor,
          type: room.type ?? "room",
          transitionId: room.transitionId ?? null,
        };
      });
      setRooms(formattedRooms);
    }).catch(err => console.error("โหลดข้อมูลไม่สำเร็จ:", err));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // เปลี่ยน mapImage ตาม selectedFloor
  useEffect(() => {
    setMapImage(floorImageMap[selectedFloor] ?? "");
  }, [selectedFloor, floorImageMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // auto-switch ชั้นตาม startRoom
  useEffect(() => {
    if (startRoom && rooms[startRoom]?.floor) {
      setSelectedFloor(rooms[startRoom].floor);
    }
  }, [startRoom, rooms]);
  // Scanner States
  const [showScanner, setShowScanner] = useState(false);
  const [scannerTarget, setScannerTarget] = useState("start"); // "start" หรือ "end"
  // ตั้งค่า startRoom จาก URL params
  // /start/:startName → สแกน QR ที่จุดนั้น (ระบุตำแหน่งปัจจุบัน)
  // /:roomName        → legacy route
  useEffect(() => {
    const name = startName || roomName;
    if (name && rooms[name]) {
      setStartRoom(name);
    }
  }, [startName, roomName, rooms]);
  // ── Helper: หาลิฟต์/บันไดที่ใกล้ที่สุดบนชั้นที่กำหนด ──────────────
  const getClosestElevatorOnFloor = (coords, floor) => {
    const candidates = Object.entries(rooms).filter(
      ([, r]) => (r.type === "elevator" || r.type === "stairs") && r.floor === floor
    );
    if (candidates.length === 0) return null;
    let closest = null, minDist = Infinity;
    candidates.forEach(([name, r]) => {
      const dx = r.coords[0] - coords[0];
      const dy = r.coords[1] - coords[1];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minDist) { minDist = d; closest = name; }
    });
    return closest;
  };

  // ── Helper: คำนวณ path บนชั้นใดก็ได้ (async) ──────────────────────
  const calcPathOnFloor = (fromCoords, toCoords, floorNum) =>
    new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = floorImageMap[floorNum] ?? "";
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = 800; c.height = 1000;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, 800, 1000);
        resolve(findPath(fromCoords, toCoords, ctx.getImageData(0, 0, 800, 1000)));
      };
      img.onerror = () => resolve([]);
    });

  // ── คำนวณเส้นทางและขั้นตอนนำทาง (รองรับข้ามชั้น) ─────────────────
  useEffect(() => {
    if (!startRoom || !endRoom || !rooms[startRoom] || !rooms[endRoom]) return;

    const startFloor = rooms[startRoom].floor;
    const endFloor   = rooms[endRoom].floor;

    const run = async () => {
      // ── เคส A: ชั้นเดียวกัน ────────────────────────────────────────
      if (startFloor === endFloor) {
        const result = await calcPathOnFloor(
          rooms[startRoom].coords, rooms[endRoom].coords, startFloor
        );
        const smoothed = result;
        setPath(smoothed);
        setNavigationPhases([{ floor: startFloor, path: smoothed }]);
        setNavigationSteps(smoothed.length > 0 ? generateNavigationSteps(smoothed) : []);
        setActiveStepIdx(0);
        return;
      }

      // ── เคส B: ต่างชั้น ─────────────────────────────────────────────
      // 1) หาลิฟต์ที่ใกล้ที่สุดบนชั้น start
      const elevOnStartName = getClosestElevatorOnFloor(rooms[startRoom].coords, startFloor);
      if (!elevOnStartName) {
        setNavigationSteps([{ action: "TRANSITION", text: `ไม่พบลิฟต์บนชั้น ${startFloor}`, distance: 0, startPointIdx: 0, endPointIdx: 0 }]);
        return;
      }
      // 2) หาลิฟต์ที่ใกล้ที่สุดบนชั้น end (ใกล้ปลายทาง)
      const elevOnEndName = getClosestElevatorOnFloor(rooms[endRoom].coords, endFloor);
      if (!elevOnEndName) {
        setNavigationSteps([{ action: "TRANSITION", text: `ไม่พบลิฟต์บนชั้น ${endFloor}`, distance: 0, startPointIdx: 0, endPointIdx: 0 }]);
        return;
      }

      const elevOnStart = rooms[elevOnStartName];
      const elevOnEnd   = rooms[elevOnEndName];

      // 3) คำนวณ path ทั้งสองชั้นพร้อมกัน
      const [path1, path2] = await Promise.all([
        calcPathOnFloor(rooms[startRoom].coords, elevOnStart.coords, startFloor),
        calcPathOnFloor(elevOnEnd.coords,        rooms[endRoom].coords,  endFloor),
      ]);

      // 4) บันทึก phases
      const phases = [
        { floor: startFloor, path: path1 },
        { floor: endFloor,   path: path2 },
      ];
      setNavigationPhases(phases);
      setPath(path1); // canvas เริ่มแสดง phase 1

      // 5) สร้าง steps รวม
      // steps ของ phase 1 — ตัด ARRIVE step ออกเพราะลิฟต์ไม่ใช่จุดหมาย
      const rawSteps1 = path1.length > 0 ? generateNavigationSteps(path1) : [];
      const steps1 = rawSteps1
        .filter(s => s.action !== "ARRIVE")
        .map(s => ({ ...s, phase: 1 }));

      // TRANSITION step — เมื่อ user กด "ถัดไป" ที่ step นี้ จะ switch ชั้น
      const transitionStep = {
        action: "TRANSITION",
        text: `เข้า${elevOnStartName} แล้วขึ้นไปชั้น ${endFloor} ออกที่ ${elevOnEndName}`,
        distance: 0,
        startPointIdx: Math.max(0, path1.length - 1),
        endPointIdx:   Math.max(0, path1.length - 1),
        phase: 1,
        // ข้อมูลที่ใช้ switch ชั้นเมื่อกด "ถัดไป"
        switchToFloor: endFloor,
        switchPath:    path2,
      };

      // steps ของ phase 2 (index อ้างอิงจาก path2 เริ่มที่ 0)
      const steps2 = path2.length > 0
        ? generateNavigationSteps(path2).map(s => ({ ...s, phase: 2 }))
        : [{ action: "ARRIVE", text: `ถึง "${endRoom}" แล้ว`, distance: 0, startPointIdx: 0, endPointIdx: 0, phase: 2 }];

      setNavigationSteps([...steps1, transitionStep, ...steps2]);
      setActiveStepIdx(0);
    };

    run();
  }, [startRoom, endRoom, rooms]); // eslint-disable-line react-hooks/exhaustive-deps
  // วาดแผนที่ (Logic เดิม + ปรับ Styling การวาดเล็กน้อย)
  // วาดแผนที่บน Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = mapImage;
    img.onload = () => {
      ctx.clearRect(0, 0, 800, 1000);
      ctx.drawImage(img, 0, 0, 800, 1000);

      // ── helper: วาดเส้นทางแบบเส้นตรง ──────────────────────────────────
      const drawLinePath = (pts, lineWidth, strokeStyle, dash = []) => {
        if (pts.length < 2) return;
        ctx.save();
        ctx.lineWidth   = lineWidth;
        ctx.strokeStyle = strokeStyle;
        ctx.lineCap     = "round";
        ctx.lineJoin    = "round";
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        pts.forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.stroke();
        ctx.restore();
      };

      // 1. วาดเส้นทางทั้งหมด
      if (path.length > 1) {
        drawLinePath(path, 5,  "#6366f1");                       // เส้นหลัก
        drawLinePath(path, 2,  "rgba(255,255,255,0.75)", [8, 6]); // dashed กลาง
      }
      // Helper วาดจุด
      const drawMarker = (coords, color, label) => {
        if (!coords) return;
        const [x, y] = coords;
        // Outer Circle
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fill();
        // Inner Circle
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fill();

        // Text Box
        ctx.font = "bold 14px 'Segoe UI', 'Sarabun', sans-serif";
        const textWidth = ctx.measureText(label).width;

        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.roundRect(x + 18, y - 13, textWidth + 12, 26, 6);
        ctx.fill();

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = "#1e293b";
        ctx.fillText(label, x + 24, y + 5);
      };
      // 2. ไฮไลต์ segment ปัจจุบัน
      if (path.length > 1 && isNavigating && navigationSteps.length > 0) {
        const currentStep = navigationSteps[activeStepIdx];
        if (currentStep?.startPointIdx !== undefined && currentStep?.endPointIdx !== undefined) {
          const activeSegment = path.slice(currentStep.startPointIdx, currentStep.endPointIdx + 1);
          if (activeSegment.length > 1) {
            drawLinePath(activeSegment, 12, "rgba(245,158,11,0.2)");        // glow
            drawLinePath(activeSegment, 7,  "#f59e0b");                     // เส้นหลัก amber
            drawLinePath(activeSegment, 2,  "rgba(255,255,255,0.85)", [8, 6]); // dashed กลาง

            // หัวลูกศรปลาย segment
            const lastPt = activeSegment[activeSegment.length - 1];
            const prevPt = activeSegment[activeSegment.length - 2];
            const angle  = Math.atan2(lastPt[1] - prevPt[1], lastPt[0] - prevPt[0]);
            ctx.fillStyle = "#f59e0b";
            ctx.beginPath();
            ctx.arc(lastPt[0], lastPt[1], 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "white";
            ctx.lineWidth   = 2.5;
            ctx.lineCap     = "round";
            ctx.beginPath();
            ctx.moveTo(lastPt[0] - 11 * Math.cos(angle - Math.PI / 6), lastPt[1] - 11 * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(lastPt[0], lastPt[1]);
            ctx.lineTo(lastPt[0] - 11 * Math.cos(angle + Math.PI / 6), lastPt[1] - 11 * Math.sin(angle + Math.PI / 6));
            ctx.stroke();
          }
        }
      }
      // วาดหมุดเริ่มต้น/ปลายทาง เฉพาะห้องที่อยู่บนชั้นที่กำลังแสดง
      if (rooms[startRoom]?.coords && rooms[startRoom]?.floor === selectedFloor) {
        drawMarker(rooms[startRoom].coords, "#22c55e", startRoom);
      }
      if (rooms[endRoom]?.coords && rooms[endRoom]?.floor === selectedFloor) {
        drawMarker(rooms[endRoom].coords, "#ef4444", endRoom);
      }
      // วาดหมุดลิฟต์/บันไดบนชั้นที่กำลังแสดง (เฉพาะกรณีข้ามชั้น)
      if (startRoom && endRoom && rooms[startRoom]?.floor !== rooms[endRoom]?.floor) {
        const refCoords = selectedFloor === rooms[startRoom]?.floor
          ? rooms[startRoom].coords
          : rooms[endRoom].coords;
        const elevName = getClosestElevatorOnFloor(refCoords, selectedFloor);
        if (elevName && rooms[elevName]?.coords) {
          const label = selectedFloor === rooms[startRoom]?.floor
            ? `ไปลิฟต์ (${elevName})`
            : `ออกลิฟต์ (${elevName})`;
          drawMarker(rooms[elevName].coords, "#3b82f6", label);
        }
      }
    };
  }, [path, startRoom, endRoom, isNavigating, activeStepIdx, navigationSteps, selectedFloor, mapImage, rooms]); // eslint-disable-line react-hooks/exhaustive-deps
  // ฟังก์ชันสแกนสำเร็จ
  const handleScanSuccess = (scannedRoom) => {
    setShowScanner(false);
    if (rooms[scannedRoom]) {
      if (scannerTarget === "start") {
        setStartRoom(scannedRoom);
      } else {
        setEndRoom(scannedRoom);
      }
    } else {
      alert(`ไม่พบพิกัดของห้อง "${scannedRoom}" ในระบบ`);
    }
  };
  const getDirectionIcon = (action) => {
    switch (action) {
      case "TURN_LEFT":
        return <CornerUpLeft className="dir-icon text-accent animate-bounce-horizontal" size={28} />;
      case "TURN_RIGHT":
        return <CornerUpRight className="dir-icon text-accent animate-bounce-horizontal" size={28} />;
      case "TRANSITION":
        return <Layers className="dir-icon text-primary animate-pulse" size={28} />;
      case "ARRIVE":
        return <CheckCircle2 className="dir-icon text-success animate-scale-up" size={32} />;
      default:
        return <ArrowRight className="dir-icon text-primary" size={28} />;
    }
  };
  return (
    <div className="page-container map-layout">
      <div className="ambient-blob blob-1"></div>
      <div className="ambient-blob blob-2"></div>
      {/* Header Bar */}
      <header className="map-header">
        <div className="header-left">
          <button onClick={() => navigate('/')} className="btn-back">
            <ChevronLeft size={24} />
          </button>
        </div>
        
        <div className="header-center">
          <span className="header-brand">Intelligent Routing Navigator </span>
          <span className="header-separator"></span>
          <span className="header-page-title">แผนที่นำทาง</span>
        </div>
        
        <div className="header-right">
          <button
            onClick={() => { setScannerTarget("start"); setShowScanner(true); }}
            className="btn-header-scanner"
            title="สแกนจุดเริ่มต้นใหม่"
          >
            <Camera size={18} />
            <span>สแกนจุดเริ่ม</span>
          </button>
        </div>
      </header>
      <div className="map-body">
        {/* พื้นที่แผนที่แสดงผล */}
        <div className="canvas-wrapper">
        <div className="canvas-card">
          <div className="canvas-floor-tag">
            <Layers size={14} />
            <span>ชั้น {selectedFloor}</span>
          </div>
          {availableFloors.length > 1 && (
            <div className="floor-selector">
              {availableFloors.map(floor => (
                <button
                  key={floor}
                  className={`floor-btn ${selectedFloor === floor ? "active" : ""}`}
                  onClick={() => setSelectedFloor(floor)}
                >
                  {floor}
                </button>
              ))}
            </div>
          )}
          <canvas ref={canvasRef} width={800} height={1000} />
        </div>
      </div>
      {/* Floating Controls Panel */}
      {!isNavigating ? (
        // --- แถบเลือกจุดหมายต้นทาง-ปลายทาง ---
        <div className="floating-panel">
          <div className="panel-header-indicator" />

          <div className="controls-container">
            {/* กล่องระบุจุดเริ่มต้น */}
            <div className="control-group">
              <div className="input-header">
                <div className="input-label">
                  <MapPin size={16} className="text-primary" />
                  <span>จุดเริ่มต้นของคุณ</span>
                </div>
                <button
                  className="btn-inline-scan"
                  onClick={() => { setScannerTarget("start"); setShowScanner(true); }}
                >
                  <Camera size={14} /> สแกน
                </button>
              </div>
              <div className="custom-select-wrapper">
                <SearchDropdown rooms={rooms} value={startRoom} onSelect={setStartRoom} />
              </div>
              {startRoom && (
                <span className="floor-badge">
                  ชั้น {rooms[startRoom]?.floor}
                </span>
              )}
            </div>
            <div className="divider-dots">
              <div className="dot" />
              <div className="dot" />
              <div className="dot" />
            </div>
            {/* กล่องระบุจุดหมายปลายทาง */}
            <div className="control-group">
              <div className="input-header">
                <div className="input-label">
                  <Navigation size={16} className="text-accent" />
                  <span>ค้นหาห้องปลายทาง</span>
                </div>
                <button
                  className="btn-inline-scan"
                  onClick={() => { setScannerTarget("end"); setShowScanner(true); }}
                >
                  <Camera size={14} /> สแกน
                </button>
              </div>
              <div className="custom-select-wrapper">
                <SearchDropdown rooms={rooms} value={endRoom} onSelect={setEndRoom} />
              </div>
              {endRoom && (
                <span className="floor-badge">
                  ชั้น {rooms[endRoom]?.floor}
                </span>
              )}
            </div>
            {/* ปุ่มเริ่มเดินทาง */}
            <button
              className={`btn-start-nav ${(!startRoom || !endRoom) ? "disabled" : ""}`}
              disabled={!startRoom || !endRoom}
              onClick={() => setIsNavigating(true)}
            >
              <Sparkles size={18} />
              <span>เริ่มนำทาง</span>
            </button>
          </div>
        </div>
      ) : (
        // --- แถบแสดงคำสั่งนำทางทีละขั้นตอน (Step-by-Step Panel) ---
        <div className="floating-panel step-panel">
          <div className="panel-header-indicator" />

          <div className="step-content-wrapper">
            <div className="step-progress-header">
              <span className="step-count">
                ขั้นตอนที่ {activeStepIdx + 1} จาก {navigationSteps.length}
              </span>
              <div className="progress-bar-bg">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${((activeStepIdx + 1) / navigationSteps.length) * 100}%` }}
                />
              </div>
            </div>
            <div className="divider-dots">
              <div className="dot"></div>
              <div className="dot"></div>
              <div className="dot"></div>
            </div>
            <div className="step-instruction-card">
              <div className="step-icon-wrapper">
                {navigationSteps[activeStepIdx] && getDirectionIcon(navigationSteps[activeStepIdx].action)}
              </div>
              <div className="step-text-wrapper">
                <p className="step-description">
                  {navigationSteps[activeStepIdx]?.text || "กำลังคำนวณ..."}
                </p>
                {navigationSteps[activeStepIdx]?.distance > 0 && (
                  <span className="step-distance-label">
                    ระยะทาง {navigationSteps[activeStepIdx].distance} เมตร
                  </span>
                )}
              </div>
            </div>
            <div className="control-group">
              <div className="input-label">
                <Navigation size={16} className="text-accent" />
                <span>ปลายทาง</span>
              </div>
              <div className="step-navigation-buttons">
                <button
                  className="btn-step-nav btn-secondary"
                  disabled={activeStepIdx === 0}
                  onClick={() => {
                    const prevIdx = activeStepIdx - 1;
                    const prevStep = navigationSteps[prevIdx];
                    // ถ้าย้อนกลับข้าม TRANSITION → กลับไปชั้น start
                    if (prevStep?.phase === 1 && navigationPhases.length > 1) {
                      setSelectedFloor(navigationPhases[0].floor);
                      setPath(navigationPhases[0].path);
                    }
                    setActiveStepIdx(prevIdx);
                  }}
                >
                  ย้อนกลับ
                </button>

                {activeStepIdx === navigationSteps.length - 1 ? (
                  <button
                    className="btn-step-nav btn-success-finish"
                    onClick={() => {
                      setIsNavigating(false);
                      setActiveStepIdx(0);
                      setNavigationPhases([]);
                      setStartRoom(null);
                      setEndRoom(null);
                      setPath([]);
                      navigate("/");
                    }}
                  >
                    🎉 ถึงจุดหมายแล้ว!
                  </button>
                ) : (
                  <button
                    className="btn-step-nav btn-primary"
                    onClick={() => {
                      const curStep = navigationSteps[activeStepIdx];
                      // ถ้า step ปัจจุบันคือ TRANSITION → switch ชั้นทันที
                      if (curStep?.switchToFloor !== undefined && navigationPhases.length > 1) {
                        setSelectedFloor(curStep.switchToFloor);
                        setPath(navigationPhases[1].path);
                      }
                      setActiveStepIdx(prev => prev + 1);
                    }}
                  >
                    ถัดไป
                  </button>
                )}
              </div>
              <button
                className="btn-cancel-nav"
                onClick={() => {
                  setIsNavigating(false);
                  setActiveStepIdx(0);
                  setNavigationPhases([]);
                  if (startRoom && rooms[startRoom]?.floor) {
                    setSelectedFloor(rooms[startRoom].floor);
                  }
                }}
              >
                ยกเลิกการนำทาง
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
      {/* โมดัลเปิดใช้กล้องสแกนเนอร์ */}
      <QRScannerModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScanSuccess={handleScanSuccess}
      />
    </div>
  );
};
/* ---------- หน้า Home ---------- */
/* ---------- หน้าแรกแนะนำการใช้งาน (Home Page) ---------- */
const Home = () => {
  const navigate = useNavigate();
  const [showScanner, setShowScanner] = useState(false);
  const [rooms, setRooms] = useState({});
  useEffect(() => {
    fetch(`${API_URL}/rooms`)
      .then(res => res.json())
      .then(data => {
        const formattedRooms = {};
        data.forEach(room => {
          formattedRooms[room.name] = { coords: room.coords, floor: room.floor };
        });
        setRooms(formattedRooms);
      })
      .catch(err => console.error("โหลดข้อมูลห้องไม่สำเร็จ:", err));
  }, []);
  const handleScanSuccess = (scannedRoom) => {
    setShowScanner(false);
    if (rooms[scannedRoom]) {
      navigate(`/${scannedRoom}`);
    } else {
      alert(`ไม่พบรหัสห้อง "${scannedRoom}" ในแผนที่นำทาง`);
    }
  };
  const handleQRUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const code = jsQR(imageData.data, img.width, img.height);
        if (code) {
          playBeepSound();
          const scannedRoom = decodeURIComponent(code.data.split("/").pop());
          if (rooms[scannedRoom]) {
            navigate(`/${scannedRoom}`);
          } else {
            alert(`ไม่พบรหัสห้อง "${scannedRoom}" ในแผนที่นำทาง`);
          }
        } else {
          alert("ไม่พบข้อมูลคิวอาร์โค้ดในภาพที่อัปโหลด");
        }
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };
  return (
    <div className="page-container home-layout">
      <div className="ambient-blob blob-1"></div>
      <div className="ambient-blob blob-2"></div>
      <div className="hero-section animate-fade-in">
                <div className="logo-box">
                  <MapIcon size={48} color="#4f46e5" />
                  <MapIcon size={46} color="#4f46e5" className="animate-pulse" />
                </div>
                <h1 className="app-title">Intelligent Routing Navigator</h1>
                <p className="app-subtitle">ระบบนำทางภายในอาคารอัจฉริยะ</p>
              </div>
              <div className="action-card animate-slide-up">
                {/* Upload Zone */}
                {/* สแกนด้วยกล้องจริง */}
                <button className="btn-camera-scan" onClick={() => setShowScanner(true)}>
                  <Camera size={22} />
                  <span>สแกนคิวอาร์โค้ดกล้องสด</span>
                </button>
                <div className="divider-text">
                  <span>หรือ</span>
                </div>
                {/* อัปโหลดคิวอาร์โค้ด */}
                <label className="upload-zone">
                  <div className="upload-content">
                    <div className="icon-circle">
                      <QrCode size={28} />
                      <QrCode size={24} />
                    </div>
                    <span className="upload-text">สแกน QR Code</span>
                    <span className="upload-subtext">เพื่อระบุตำแหน่งปัจจุบันของคุณ</span>
                    <span className="upload-text">อัปโหลดภาพ QR Code</span>
                    <span className="upload-subtext">เพื่อระบุตำแหน่งห้องเริ่มต้น</span>
                  </div>
                  <input type="file" accept="image/*" onChange={handleQRUpload} className="hidden-input" />
                </label>
                <div className="divider-text">
                  <span>หรือ</span>
                </div>
                {/* เลือกจุดเริ่มต้นและปลายทางเอง → ไปหน้า MapPage เปล่า */}
                <button className="btn-manual-nav" onClick={() => navigate("/map")}>
                  <Navigation size={18} />
                  <span>เลือกจุดเริ่มต้นและปลายทางเอง</span>
                </button>
              </div>
              <QRScannerModal
                isOpen={showScanner}
                onClose={() => setShowScanner(false)}
                onScanSuccess={handleScanSuccess}
              />
            </div>
    );
};
/* ========== Admin Login ========== */
const AdminLogin = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      sessionStorage.setItem("admin", JSON.stringify(data));
      navigate("/admin");
    } catch {
      setError("ไม่สามารถเชื่อมต่อ server ได้");
    } finally { setLoading(false); }
  };

  return (
    <div className="page-container home-layout">
      <div className="hero-section animate-fade-in">
        <div className="logo-box"><MapPin size={36} color="#4f46e5" /></div>
        <h1 className="app-title" style={{ fontSize: "1.6rem" }}>Admin Panel</h1>
        <p className="app-subtitle">ระบบจัดการข้อมูลแผนที่นำทาง</p>
      </div>
      <div className="action-card animate-slide-up" style={{ maxWidth: 400 }}>
        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          <div className="control-group">
            <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-sub)", marginBottom: 4 }}>ชื่อผู้ใช้</label>
            <input type="text" required autoComplete="username"
              value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
              placeholder="กรอกชื่อผู้ใช้"
              style={{ width: "100%", padding: "10px 14px", borderRadius: 12, border: "1.5px solid var(--border)", fontSize: "0.95rem", outline: "none", fontFamily: "inherit" }}
            />
          </div>
          <div className="control-group">
            <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-sub)", marginBottom: 4 }}>รหัสผ่าน</label>
            <input type="password" required autoComplete="current-password"
              value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              placeholder="กรอกรหัสผ่าน"
              style={{ width: "100%", padding: "10px 14px", borderRadius: 12, border: "1.5px solid var(--border)", fontSize: "0.95rem", outline: "none", fontFamily: "inherit" }}
            />
          </div>
          {error && <p style={{ color: "var(--danger)", fontSize: "0.85rem", textAlign: "center" }}>{error}</p>}
          <button type="submit" className="btn-camera-scan" disabled={loading}>
            {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>
        <button className="btn-manual-nav" onClick={() => navigate("/")}>
          <ChevronLeft size={16} /> กลับหน้าหลัก
        </button>
      </div>
    </div>
  );
};

/* ========== Admin Dashboard (Single Page) ========== */
const API = process.env.REACT_APP_API_URL || `http://${window.location.hostname}:5000`;
const emptyRoom  = { name: "", floor: 10, coords: [0, 0], type: "room", transitionId: "" };
const emptyFloor = { floor: 10, name: "" };

const AdminDashboard = () => {
  const navigate = useNavigate();
  const mapImgRef = useRef(null);

  // Data
  const [rooms,  setRooms]  = useState([]);
  const [floors, setFloors] = useState([]);
  const [msg, setMsg] = useState({ text: "", ok: true });

  // Selected floor for the whole page
  const [activeFloor, setActiveFloor] = useState(10);

  // Room form
  const [roomForm,    setRoomForm]    = useState({ ...emptyRoom, floor: 10 });
  const [editingRoom, setEditingRoom] = useState(null);
  const [clickedXY,   setClickedXY]  = useState(null);

  // Floor form (inline accordion)
  const [showFloorForm, setShowFloorForm] = useState(false);
  const [floorForm,     setFloorForm]     = useState(emptyFloor);
  const [editingFloor,  setEditingFloor]  = useState(null);

  // Map upload
  const [mapFile,        setMapFile]        = useState(null);
  const [mapPreview,     setMapPreview]     = useState("");
  const [mapUploadFloor, setMapUploadFloor] = useState(10);
  const [mapUploading,   setMapUploading]   = useState(false);

  // Filter
  const [filterType, setFilterType] = useState("all");

  const toMapUrl = (mapImage, version) => {
    if (!mapImage) return null;
    if (mapImage.startsWith("http")) {
      return version ? `${mapImage}?v=${version}` : mapImage;
    }
    const filename = mapImage.includes("/maps/")
      ? mapImage.split("/maps/").pop().split("?")[0]
      : mapImage.split("?")[0];
    const base = `${API}/maps/${filename}`;
    return version ? `${base}?v=${version}` : base;
  };

  const floorImageMap = floors.reduce(
    (map, f) => {
      if (f.mapImage) map[f.floor] = toMapUrl(f.mapImage, f.mapVersion);
      return map;
    },
    {}
  );

  // Guard
  useEffect(() => {
    if (!sessionStorage.getItem("admin")) navigate("/admin/login");
  }, [navigate]);

  const loadRooms  = useCallback(() => fetch(`${API}/rooms`).then(r => r.json()).then(setRooms).catch(() => {}), []);
  const loadFloors = useCallback(() => fetch(`${API}/floors`).then(r => r.json()).then(setFloors).catch(() => {}), []);
  useEffect(() => { loadRooms(); loadFloors(); }, [loadRooms, loadFloors]);

  const flash = (text, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg({ text: "", ok: true }), 3000); };

  // ── Map click → set coords ──────────────────────────────────────────
  const handleMapClick = (e) => {
    const img  = mapImgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (800 / rect.width));
    const y = Math.round((e.clientY - rect.top)  * (1000 / rect.height));
    setClickedXY([x, y]);
    setRoomForm(p => ({ ...p, coords: [x, y], floor: activeFloor }));
  };

  // ── Floor switch ────────────────────────────────────────────────────
  const switchFloor = (f) => {
    setActiveFloor(f);
    setClickedXY(null);
    setRoomForm(p => ({ ...p, floor: f, coords: [0, 0] }));
    if (!editingRoom) setRoomForm({ ...emptyRoom, floor: f });
  };

  // ── Room CRUD ───────────────────────────────────────────────────────
  const saveRoom = async () => {
    if (!roomForm.name.trim()) { flash("⚠️ กรุณากรอกชื่อห้อง", false); return; }
    if (!clickedXY && roomForm.coords[0] === 0 && roomForm.coords[1] === 0) {
      flash("⚠️ กรุณาคลิกเลือกพิกัดบนแผนที่", false); return;
    }
    const body = { ...roomForm, floor: Number(activeFloor), coords: [Number(roomForm.coords[0]), Number(roomForm.coords[1])] };
    const url    = editingRoom ? `${API}/rooms/${editingRoom}` : `${API}/rooms`;
    const method = editingRoom ? "PUT" : "POST";
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    flash(editingRoom ? "✅ แก้ไขห้องสำเร็จ" : "✅ เพิ่มห้องสำเร็จ");
    setRoomForm({ ...emptyRoom, floor: activeFloor });
    setEditingRoom(null); setClickedXY(null); loadRooms();
  };

  const deleteRoom = async (id) => {
    if (!window.confirm("ลบห้องนี้?")) return;
    await fetch(`${API}/rooms/${id}`, { method: "DELETE" });
    flash("🗑️ ลบห้องแล้ว"); loadRooms();
  };

  const startEditRoom = (r) => {
    setRoomForm({ name: r.name, floor: r.floor, coords: r.coords || [0,0], type: r.type || "room", transitionId: r.transitionId || "" });
    setEditingRoom(r._id);
    setActiveFloor(r.floor);
    setClickedXY(r.coords || null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEditRoom = () => {
    setRoomForm({ ...emptyRoom, floor: activeFloor });
    setEditingRoom(null); setClickedXY(null);
  };

  // ── Upload Map ──────────────────────────────────────────────────────
  const uploadMap = async () => {
    if (!mapFile) { flash("⚠️ กรุณาเลือกไฟล์รูปภาพก่อน", false); return; }
    setMapUploading(true);
    try {
      const formData = new FormData();
      formData.append("floor", String(mapUploadFloor));
      formData.append("map", mapFile);
      const res  = await fetch(`${API}/upload-map`, { method: "POST", body: formData });
      const data = await res.json();
      if (data.filename || data.imageUrl) {
        flash(`✅ อัปโหลดแผนที่ชั้น ${mapUploadFloor} สำเร็จ`);
        loadFloors();
      } else {
        flash("❌ อัปโหลดไม่สำเร็จ: " + (data.error || "unknown error"), false);
      }
    } catch { flash("❌ ไม่สามารถเชื่อมต่อ server ได้", false); }
    finally { setMapUploading(false); }
  };

  // ── Floor CRUD ──────────────────────────────────────────────────────
  const saveFloor = async () => {
    if (!floorForm.floor) { flash("⚠️ กรุณากรอกหมายเลขชั้น", false); return; }
    const body = { ...floorForm, floor: Number(floorForm.floor) };
    const url    = editingFloor ? `${API}/floors/${editingFloor}` : `${API}/floors`;
    const method = editingFloor ? "PUT" : "POST";
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    flash(editingFloor ? "✅ แก้ไขชั้นสำเร็จ" : "✅ เพิ่มชั้นสำเร็จ");
    setFloorForm(emptyFloor); setEditingFloor(null); setShowFloorForm(false); loadFloors();
  };

  const deleteFloor = async (id) => {
    if (!window.confirm("ลบชั้นนี้?")) return;
    await fetch(`${API}/floors/${id}`, { method: "DELETE" });
    flash("🗑️ ลบชั้นแล้ว"); loadFloors();
  };

  const startEditFloor = (f) => {
    setFloorForm({ floor: f.floor, name: f.name || "" });
    setEditingFloor(f._id); setShowFloorForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── Derived ─────────────────────────────────────────────────────────
  const allFloorNums = [...new Set([...floors.map(f => f.floor), ...rooms.map(r => r.floor)])].sort((a, b) => a - b);
  const roomsOnFloor = rooms.filter(r => r.floor === activeFloor && (filterType === "all" || r.type === filterType));

  const iStyle = { width: "100%", padding: "8px 12px", borderRadius: 10, border: "1.5px solid var(--border)", fontSize: "0.88rem", fontFamily: "inherit", outline: "none", background: "white" };
  const lStyle = { fontSize: "0.73rem", fontWeight: 700, color: "var(--text-sub)", marginBottom: 3, display: "block", textTransform: "uppercase", letterSpacing: "0.4px" };

  const typeColor = (t) => ({ elevator: ["#dbeafe","#1d4ed8"], stairs: ["#fef9c3","#854d0e"], toilet: ["#dcfce7","#166534"] }[t] ?? ["var(--bg-surface)","var(--text-sub)"]);

  return (
    <div className="admin-page">
      {/* Header */}
      <header className="map-header admin-header">
        <button className="btn-back" onClick={() => navigate("/")}><ChevronLeft size={18} /></button>
        <span className="header-title">⚙️ Admin</span>
        <button onClick={() => { sessionStorage.removeItem("admin"); navigate("/admin/login"); }}
          style={{ padding: "5px 12px", borderRadius: 8, border: "1.5px solid #fca5a5", background: "var(--danger-light)", color: "var(--danger)", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700 }}>
          ออกจากระบบ
        </button>
      </header>

      <div className="admin-shell">
        {/* Flash */}
        {msg.text && (
          <div className={`admin-flash ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>
        )}

        {/* ════════ SECTION 1: เลือกชั้น ════════ */}
        <div className="action-card admin-floor-card" style={{ padding: "1.1rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-sub)" }}>📐 ชั้นที่กำลังแก้ไข:</span>
              {allFloorNums.map(f => (
                <button key={f} onClick={() => switchFloor(f)}
                  style={{ padding: "5px 14px", borderRadius: 8, border: "1.5px solid", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer",
                    background: activeFloor === f ? "var(--primary)" : "white",
                    color: activeFloor === f ? "white" : "var(--text-main)",
                    borderColor: activeFloor === f ? "var(--primary)" : "var(--border)" }}>
                  ชั้น {f}
                </button>
              ))}
            </div>
            <button onClick={() => { setShowFloorForm(p => !p); setFloorForm(emptyFloor); setEditingFloor(null); }}
              style={{ padding: "5px 14px", borderRadius: 8, border: "1.5px solid var(--primary-mid)", background: showFloorForm ? "var(--primary)" : "var(--primary-light)", color: showFloorForm ? "white" : "var(--primary)", cursor: "pointer", fontSize: "0.82rem", fontWeight: 700 }}>
              {showFloorForm ? "ปิด" : "➕ เพิ่ม/แก้ไขชั้น"}
            </button>
          </div>

          {/* Accordion: floor form */}
          {showFloorForm && (
            <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
              <p style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--primary)", marginBottom: "0.75rem" }}>
                {editingFloor ? "✏️ แก้ไขชั้น" : "➕ เพิ่มชั้นใหม่"}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
                <div><label style={lStyle}>หมายเลขชั้น *</label><input type="number" placeholder="เช่น 12" style={iStyle} value={floorForm.floor} onChange={e => setFloorForm(p => ({ ...p, floor: e.target.value }))} /></div>
                <div><label style={lStyle}>ชื่อชั้น</label><input type="text" placeholder="เช่น ชั้น 12" style={iStyle} value={floorForm.name} onChange={e => setFloorForm(p => ({ ...p, name: e.target.value }))} /></div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button className="btn-start-nav" style={{ flex: 1, padding: "9px" }} onClick={saveFloor}>{editingFloor ? "💾 บันทึก" : "➕ เพิ่มชั้น"}</button>
                {editingFloor && <button className="btn-manual-nav" style={{ padding: "9px 16px" }} onClick={() => { setFloorForm(emptyFloor); setEditingFloor(null); }}>ยกเลิก</button>}
              </div>
              {/* รายการชั้นที่มี */}
              {floors.length > 0 && (
                <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {floors.sort((a,b) => a.floor - b.floor).map(f => (
                    <div key={f._id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", borderRadius: 8, background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
                      <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>ชั้น {f.floor}{f.name ? ` — ${f.name}` : ""}</span>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button onClick={() => startEditFloor(f)} style={{ padding: "3px 10px", borderRadius: 6, border: "1.5px solid var(--primary-mid)", background: "var(--primary-light)", color: "var(--primary)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 700 }}>แก้ไข</button>
                        <button onClick={() => deleteFloor(f._id)} style={{ padding: "3px 10px", borderRadius: 6, border: "1.5px solid #fca5a5", background: "var(--danger-light)", color: "var(--danger)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 700 }}>ลบ</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* อัปโหลดแผนที่ */}
              <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
                <p style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--primary)", marginBottom: "0.75rem" }}>🗺️ อัปโหลดรูปแผนที่</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
                  <div>
                    <label style={lStyle}>ชั้นที่ต้องการอัปโหลด</label>
                    <select style={iStyle} value={mapUploadFloor} onChange={e => { setMapUploadFloor(Number(e.target.value)); setMapPreview(""); setMapFile(null); }}>
                      {allFloorNums.length > 0
                        ? allFloorNums.map(f => <option key={f} value={f}>ชั้น {f}</option>)
                        : [9, 10, 11].map(n => <option key={n} value={n}>ชั้น {n}</option>)
                      }
                    </select>
                  </div>
                  <div>
                    <label style={lStyle}>ไฟล์รูป (PNG/JPG)</label>
                    <input type="file" accept="image/*" style={{ ...iStyle, padding: "6px 10px" }}
                      onChange={e => {
                        const f = e.target.files[0];
                        if (!f) return;
                        setMapFile(f);
                        setMapPreview(URL.createObjectURL(f));
                      }}
                    />
                  </div>
                </div>
                {mapPreview && (
                  <div style={{ marginBottom: "0.75rem" }}>
                    <img src={mapPreview} alt="preview" style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 8, border: "1px solid var(--border)" }} />
                  </div>
                )}
                <button className="btn-start-nav" style={{ padding: "9px 20px" }} onClick={uploadMap} disabled={mapUploading}>
                  {mapUploading ? "⏳ กำลังอัปโหลด..." : "⬆️ อัปโหลดแผนที่"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ════════ SECTION 2: แผนที่ + Form ════════ */}
        <div className="admin-grid">

          {/* แผนที่ */}
          <div className="action-card admin-map-card admin-card" style={{ padding: "1rem" }}>
            <p style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--primary)", marginBottom: "0.5rem" }}>
              🗺️ แผนที่ชั้น {activeFloor} — คลิกเพื่อเลือกพิกัดห้อง
            </p>
            <div className="admin-map-plot" style={{ position: "relative", cursor: "crosshair", border: "1.5px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              <img ref={mapImgRef} src={floorImageMap[activeFloor] ?? ""} alt={`floor ${activeFloor}`}
                onClick={handleMapClick} draggable={false}
                className="admin-map-img" />
              {/* จุดห้องที่มีอยู่ */}
              {rooms.filter(r => r.floor === activeFloor && r.coords).map(r => (
                <div key={r._id} onClick={() => startEditRoom(r)}
                  title={r.name}
                  style={{
                    position: "absolute",
                    left: `${(r.coords[0] / 800) * 100}%`,
                    top:  `${(r.coords[1] / 1000) * 100}%`,
                    transform: "translate(-50%,-50%)",
                    width: r._id === editingRoom ? 14 : 10,
                    height: r._id === editingRoom ? 14 : 10,
                    background: r._id === editingRoom ? "#f59e0b" : typeColor(r.type)[1],
                    border: "2px solid white",
                    borderRadius: "50%",
                    cursor: "pointer",
                    zIndex: 5,
                    boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                  }} />
              ))}
              {/* จุดที่เพิ่งคลิก */}
              {clickedXY && (
                <div style={{
                  position: "absolute",
                  left: `${(clickedXY[0] / 800) * 100}%`,
                  top:  `${(clickedXY[1] / 1000) * 100}%`,
                  transform: "translate(-50%,-50%)",
                  width: 18, height: 18,
                  background: "#ef4444",
                  border: "2.5px solid white",
                  borderRadius: "50%",
                  boxShadow: "0 0 0 4px rgba(239,68,68,0.3)",
                  zIndex: 10, pointerEvents: "none",
                }} />
              )}
            </div>
            <p style={{ fontSize: "0.72rem", color: "var(--text-hint)", marginTop: "0.4rem" }}>
              ● กดที่จุดสีเพื่อแก้ไขห้องนั้น &nbsp;|&nbsp; ● จุดแดง = ตำแหน่งที่เลือก
            </p>
          </div>

          {/* Form + รายการ */}
          <div className="admin-side-panel" style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            {/* Room form */}
            <div className="action-card admin-card admin-form-card" style={{ padding: "1rem" }}>
              <p style={{ fontSize: "0.88rem", fontWeight: 700, color: "var(--primary)", marginBottom: "0.75rem" }}>
                {editingRoom ? "✏️ แก้ไขห้อง" : "➕ เพิ่มห้องใหม่"}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <div><label style={lStyle}>ชื่อห้อง *</label><input type="text" placeholder="เช่น 11-1000A" style={iStyle} value={roomForm.name} onChange={e => setRoomForm(p => ({ ...p, name: e.target.value }))} /></div>
                <div><label style={lStyle}>ประเภท</label>
                  <select style={iStyle} value={roomForm.type} onChange={e => setRoomForm(p => ({ ...p, type: e.target.value }))}>
                    <option value="room">room (ห้องปกติ)</option>
                    <option value="elevator">elevator (ลิฟต์)</option>
                    <option value="stairs">stairs (บันได)</option>
                    <option value="toilet">toilet (ห้องน้ำ)</option>
                  </select>
                </div>
                <div><label style={lStyle}>Transition ID (ถ้ามี)</label><input type="text" placeholder="เช่น E1" style={iStyle} value={roomForm.transitionId} onChange={e => setRoomForm(p => ({ ...p, transitionId: e.target.value }))} /></div>
                <div style={{ padding: "8px 12px", borderRadius: 10, border: `1.5px solid ${clickedXY ? "var(--primary-mid)" : "var(--border)"}`, background: clickedXY ? "var(--primary-light)" : "var(--bg-surface)", fontSize: "0.85rem", fontWeight: clickedXY ? 700 : 400, color: clickedXY ? "var(--primary)" : "var(--text-hint)" }}>
                  {clickedXY ? `📍 X: ${clickedXY[0]}, Y: ${clickedXY[1]}` : "👈 คลิกบนแผนที่เพื่อเลือกพิกัด"}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.85rem" }}>
                <button className="btn-start-nav" style={{ flex: 1, padding: "10px", fontSize: "0.88rem" }} onClick={saveRoom}>
                  {editingRoom ? "💾 บันทึก" : "➕ เพิ่มห้อง"}
                </button>
                {editingRoom && (
                  <button className="btn-manual-nav" style={{ padding: "10px 14px", fontSize: "0.85rem" }} onClick={cancelEditRoom}>ยกเลิก</button>
                )}
              </div>
            </div>

            {/* รายการห้องบนชั้นนี้ */}
            <div className="action-card admin-card admin-list-card" style={{ padding: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem" }}>
                <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-main)" }}>
                  ห้องชั้น {activeFloor} ({rooms.filter(r => r.floor === activeFloor).length})
                </p>
                <select style={{ ...iStyle, width: "auto", padding: "4px 8px", fontSize: "0.78rem" }} value={filterType} onChange={e => setFilterType(e.target.value)}>
                  <option value="all">ทุกประเภท</option>
                  <option value="room">room</option>
                  <option value="elevator">elevator</option>
                  <option value="stairs">stairs</option>
                  <option value="toilet">toilet</option>
                </select>
              </div>
              <div className="admin-room-list">
                {roomsOnFloor.map(r => (
                  <div key={r._id}
                    className={`admin-room-item${r._id === editingRoom ? " active" : ""}`}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontWeight: 700, fontSize: "0.85rem", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</p>
                      <p style={{ fontSize: "0.72rem", color: "var(--text-sub)", margin: 0 }}>
                        <span style={{ background: typeColor(r.type)[0], color: typeColor(r.type)[1], padding: "1px 6px", borderRadius: 4, fontWeight: 700 }}>{r.type || "room"}</span>
                        &nbsp;[{r.coords?.[0]}, {r.coords?.[1]}]
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
                      <button onClick={() => startEditRoom(r)} style={{ padding: "3px 8px", borderRadius: 6, border: "1.5px solid var(--primary-mid)", background: "var(--primary-light)", color: "var(--primary)", cursor: "pointer", fontSize: "0.73rem", fontWeight: 700 }}>แก้ไข</button>
                      <button onClick={() => deleteRoom(r._id)} style={{ padding: "3px 8px", borderRadius: 6, border: "1.5px solid #fca5a5", background: "var(--danger-light)", color: "var(--danger)", cursor: "pointer", fontSize: "0.73rem", fontWeight: 700 }}>ลบ</button>
                    </div>
                  </div>
                ))}
                {roomsOnFloor.length === 0 && (
                  <p style={{ textAlign: "center", color: "var(--text-hint)", fontSize: "0.85rem", padding: "1rem 0" }}>ยังไม่มีห้องในชั้นนี้</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/map" element={<MapPage />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/start/:startName" element={<MapPage />} />
      <Route path="/:roomName" element={<MapPage />} />
    </Routes>
  );
}
