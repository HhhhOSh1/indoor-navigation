import { useState } from "react";

const API_URL = process.env.REACT_APP_API_URL || (window.location.port === "3000" ? `http://${window.location.hostname}:5000` : "");

export default function AdminPage() {
  const [selectedFloor, setSelectedFloor] = useState(9);
  const [roomName, setRoomName] = useState("");
  const [roomType, setRoomType] = useState("room");

  const [coords, setCoords] = useState([0, 0]);

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");

  const uploadMap = async () => {
    if (!file) {
      alert("กรุณาเลือกรูป");
      return;
    }

    const formData = new FormData();
    formData.append("map", file);

    try {
      const res = await fetch(
        `${API_URL}/upload-map`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await res.json();

      alert("อัปโหลดสำเร็จ");

      console.log(data);
    } catch (err) {
      console.log(err);
    }
  };

  const saveRoom = async () => {
    try {
      const roomData = {
        name: roomName,
        floor: Number(selectedFloor),
        coords,
        type: roomType,
      };

      const res = await fetch(
        `${API_URL}/rooms`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify(roomData),
        }
      );

      const data = await res.json();

      console.log(data);

      alert("เพิ่มห้องสำเร็จ");

      setRoomName("");
    } catch (err) {
      console.log(err);
    }
  };

  const handleMapClick = (e) => {
    const rect =
      e.target.getBoundingClientRect();

    const x = Math.round(
      e.clientX - rect.left
    );

    const y = Math.round(
      e.clientY - rect.top
    );

    setCoords([x, y]);
  };

  return (
    <div
      style={{
        padding: "20px",
      }}
    >
      <h1>Admin Panel</h1>

      <hr />

      <h2>อัปโหลดแผนที่</h2>

      <select
        value={selectedFloor}
        onChange={(e) =>
          setSelectedFloor(
            e.target.value
          )
        }
      >
        <option value={9}>
          ชั้น 9
        </option>

        <option value={10}>
          ชั้น 10
        </option>

        <option value={11}>
          ชั้น 11
        </option>
      </select>

      <br />
      <br />

      <input
        type="file"
        accept="image/*"
        onChange={(e) => {
          const selectedFile =
            e.target.files[0];

          setFile(selectedFile);

          setPreview(
            URL.createObjectURL(
              selectedFile
            )
          );
        }}
      />

      <br />
      <br />

      <button
        onClick={uploadMap}
      >
        Upload Map
      </button>

      <hr />

      {preview && (
        <>
          <h2>
            คลิกบนแผนที่เพื่อเลือกตำแหน่ง
          </h2>

          <img
            src={preview}
            alt=""
            onClick={
              handleMapClick
            }
            style={{
              width: "800px",
              cursor: "crosshair",
              border:
                "1px solid #ccc",
            }}
          />

          <p>
            X : {coords[0]}
          </p>

          <p>
            Y : {coords[1]}
          </p>
        </>
      )}

      <hr />

      <h2>เพิ่มห้อง</h2>

      <input
        placeholder="ชื่อห้อง"
        value={roomName}
        onChange={(e) =>
          setRoomName(
            e.target.value
          )
        }
      />

      <br />
      <br />

      <select
        value={roomType}
        onChange={(e) =>
          setRoomType(
            e.target.value
          )
        }
      >
        <option value="room">
          room
        </option>

        <option value="office">
          office
        </option>

        <option value="meeting">
          meeting
        </option>

        <option value="toilet">
          toilet
        </option>

        <option value="elevator">
          elevator
        </option>

        <option value="stairs">
          stairs
        </option>
      </select>

      <br />
      <br />

      <button
        onClick={saveRoom}
      >
        บันทึกห้อง
      </button>
    </div>
  );
}