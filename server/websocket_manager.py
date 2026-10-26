"""
CARE — Clinical Action and Response Engine
BIU Server: WebSocket Manager

Manages real-time WebSocket connections to the dashboard.
Pushes updates for vitals, alarms, incidents, and escalations.
"""

import json
import logging
import asyncio
from datetime import datetime
from typing import Optional
from fastapi import WebSocket

logger = logging.getLogger("care.websocket")


class ConnectionManager:
    """
    Manages WebSocket connections from dashboard clients.
    Supports role-based filtering so each role gets only relevant updates.
    """

    def __init__(self):
        self.active_connections: list[dict] = []
        # Each entry: {"ws": WebSocket, "role": str|None, "bed_id": str|None}

    async def connect(self, websocket: WebSocket, role: Optional[str] = None, bed_id: Optional[str] = None):
        """Accept a new WebSocket connection."""
        await websocket.accept()
        conn = {
            "ws": websocket,
            "role": role,
            "bed_id": bed_id,
            "connected_at": datetime.now().isoformat(),
        }
        self.active_connections.append(conn)
        logger.info(f"WebSocket connected: role={role}, bed={bed_id} "
                     f"(total: {len(self.active_connections)})")

    def disconnect(self, websocket: WebSocket):
        """Remove a disconnected WebSocket."""
        self.active_connections = [
            c for c in self.active_connections
            if c["ws"] != websocket
        ]
        logger.info(f"WebSocket disconnected (total: {len(self.active_connections)})")

    async def broadcast(self, message_type: str, data: dict):
        """Broadcast a message to ALL connected clients."""
        message = json.dumps({
            "type": message_type,
            "data": data,
            "timestamp": datetime.now().isoformat(),
        }, default=str)

        disconnected = []
        for conn in self.active_connections:
            try:
                await conn["ws"].send_text(message)
            except Exception:
                disconnected.append(conn)

        for conn in disconnected:
            self.active_connections.remove(conn)

    async def send_to_role(self, role: str, message_type: str, data: dict):
        """Send a message to all clients subscribed to a specific role."""
        message = json.dumps({
            "type": message_type,
            "data": data,
            "timestamp": datetime.now().isoformat(),
        }, default=str)

        disconnected = []
        for conn in self.active_connections:
            # Send to matching role or to clients without a role filter (they get everything)
            if conn["role"] is None or conn["role"] == role:
                try:
                    await conn["ws"].send_text(message)
                except Exception:
                    disconnected.append(conn)

        for conn in disconnected:
            self.active_connections.remove(conn)

    async def send_to_bed(self, bed_id: str, message_type: str, data: dict):
        """Send a message to all clients watching a specific bed."""
        message = json.dumps({
            "type": message_type,
            "data": data,
            "timestamp": datetime.now().isoformat(),
        }, default=str)

        disconnected = []
        for conn in self.active_connections:
            if conn["bed_id"] is None or conn["bed_id"] == bed_id:
                try:
                    await conn["ws"].send_text(message)
                except Exception:
                    disconnected.append(conn)

        for conn in disconnected:
            self.active_connections.remove(conn)

    async def send_personal(self, websocket: WebSocket, message_type: str, data: dict):
        """Send a message to a specific client."""
        message = json.dumps({
            "type": message_type,
            "data": data,
            "timestamp": datetime.now().isoformat(),
        }, default=str)

        try:
            await websocket.send_text(message)
        except Exception:
            self.disconnect(websocket)

    def get_connection_count(self) -> int:
        """Return the number of active connections."""
        return len(self.active_connections)

    def get_connections_info(self) -> list[dict]:
        """Return info about all active connections."""
        return [
            {
                "role": c["role"],
                "bed_id": c["bed_id"],
                "connected_at": c["connected_at"],
            }
            for c in self.active_connections
        ]
