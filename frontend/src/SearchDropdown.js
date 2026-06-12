import React, { useState, useRef, useEffect } from "react";
import "./SearchDropdown.css";

const SearchDropdown = ({ rooms, value, onSelect, style }) => {
  const [searchTerm, setSearchTerm] = useState(value || "");
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const filteredRooms = Object.keys(rooms).filter((room) =>
    room.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    if (value !== undefined && value !== null) {
      setSearchTerm(value);
    } else {
      setSearchTerm("");
    }
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleSelect = (room) => {
    onSelect(room);
    setSearchTerm(room);
    setIsOpen(false);
  };

  return (
    <div
      className="search-dropdown-container"
      ref={dropdownRef}
      style={style}
    >
      <div className="search-input-wrapper">
        <input
          type="text"
          placeholder="🔍 ค้นหาหรือเลือกห้อง..."
          className="search-input"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filteredRooms.length > 0) {
              handleSelect(filteredRooms[0]);
            }
          }}
        />

        <span className="search-icon">⌕</span>
      </div>

      {isOpen && (
        <ul className="dropdown-list">
          {filteredRooms.length > 0 ? (
            filteredRooms.map((room) => (
              <li
                key={room}
                className="dropdown-item"
                onClick={() => handleSelect(room)}
              >
                <span className="room-icon">📍</span>
                <span className="room-name">{room}</span>
              </li>
            ))
          ) : (
            <li className="dropdown-item empty">
              <span className="empty-message">
                ไม่พบห้องที่ค้นหา
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

export default SearchDropdown;