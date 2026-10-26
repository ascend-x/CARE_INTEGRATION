"""
CARE — Clinical Action and Response Engine
BIU Server: Serial Listener

Reads JSON data from Arduino nodes over USB serial ports.
Runs in background threads, one per serial port.
"""

import json
import threading
import time
import logging
from datetime import datetime
from typing import Callable, Optional

logger = logging.getLogger("care.serial")


class SerialListener:
    """
    Listens to one USB serial port for JSON packets from an Arduino node.
    Runs in a dedicated thread.
    """

    def __init__(
        self,
        port: str,
        baud_rate: int = 115200,
        on_data: Optional[Callable] = None,
        node_id: Optional[int] = None,
    ):
        self.port = port
        self.baud_rate = baud_rate
        self.on_data = on_data
        self.node_id = node_id
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.serial_conn = None
        self.connected = False
        self.last_received: Optional[datetime] = None
        self.error_count = 0
        self.packet_count = 0

        # Clock sync
        self.clock_offset_ms = 0
        self.clock_sync_samples: list[int] = []

    def start(self):
        """Start the serial listener in a background thread."""
        self.running = True
        self.thread = threading.Thread(
            target=self._listen_loop,
            name=f"serial-node-{self.node_id or self.port}",
            daemon=True,
        )
        self.thread.start()
        logger.info(f"Serial listener started on {self.port} for node {self.node_id}")

    def stop(self):
        """Stop the listener and close the serial port."""
        self.running = False
        if self.serial_conn:
            try:
                self.serial_conn.close()
            except Exception:
                pass
        if self.thread:
            self.thread.join(timeout=2.0)
        logger.info(f"Serial listener stopped on {self.port}")

    def _listen_loop(self):
        """Main loop: connect, read lines, parse JSON, call callback."""
        while self.running:
            try:
                self._connect()
                if not self.connected:
                    time.sleep(2.0)  # Retry delay
                    continue

                self._read_loop()

            except Exception as e:
                logger.error(f"Serial error on {self.port}: {e}")
                self.connected = False
                self.error_count += 1
                time.sleep(2.0)

    def _connect(self):
        """Attempt to open the serial port."""
        try:
            import serial
            self.serial_conn = serial.Serial(
                port=self.port,
                baudrate=self.baud_rate,
                timeout=1.0,
            )
            self.connected = True
            self.error_count = 0
            logger.info(f"Connected to {self.port}")

            # Flush any startup garbage
            time.sleep(0.5)
            self.serial_conn.reset_input_buffer()

        except ImportError:
            logger.warning(
                "pyserial not installed. Serial listener will not function. "
                "Install with: pip install pyserial"
            )
            self.running = False
        except Exception as e:
            logger.warning(f"Could not open {self.port}: {e}")
            self.connected = False

    def _read_loop(self):
        """Read lines from serial, parse JSON, dispatch."""
        buffer = ""
        while self.running and self.connected:
            try:
                if self.serial_conn and self.serial_conn.in_waiting > 0:
                    raw = self.serial_conn.readline()
                    if raw:
                        line = raw.decode("utf-8", errors="replace").strip()
                        if line:
                            self._process_line(line)
                else:
                    time.sleep(0.01)  # Small sleep to avoid busy-waiting

            except Exception as e:
                logger.warning(f"Read error on {self.port}: {e}")
                self.connected = False
                break

    def _process_line(self, line: str):
        """Parse a JSON line and invoke the callback."""
        try:
            data = json.loads(line)
            receive_time = datetime.now()

            # Handle boot event
            if data.get("event") == "boot":
                logger.info(
                    f"Node {data.get('node')} booted with profile "
                    f"{data.get('profile')} on {self.port}"
                )
                if self.node_id is None:
                    self.node_id = data.get("node")
                return

            # Clock offset estimation
            if "ts" in data:
                arduino_ms = data["ts"]
                server_ms = int(receive_time.timestamp() * 1000)
                offset = server_ms - arduino_ms
                self.clock_sync_samples.append(offset)
                if len(self.clock_sync_samples) > 100:
                    self.clock_sync_samples.pop(0)
                # Use median for robustness
                sorted_offsets = sorted(self.clock_sync_samples)
                self.clock_offset_ms = sorted_offsets[len(sorted_offsets) // 2]

            # Augment data
            data["_server_time"] = receive_time.isoformat()
            data["_clock_offset_ms"] = self.clock_offset_ms
            data["_port"] = self.port

            self.last_received = receive_time
            self.packet_count += 1

            # Dispatch to callback
            if self.on_data:
                self.on_data(data)

        except json.JSONDecodeError:
            # Not JSON — could be debug output, ignore
            logger.debug(f"Non-JSON from {self.port}: {line[:80]}")
        except Exception as e:
            logger.warning(f"Processing error on {self.port}: {e}")


class SerialManager:
    """
    Manages multiple serial listeners (one per Arduino node).
    """

    def __init__(self, on_data: Optional[Callable] = None):
        self.listeners: dict[str, SerialListener] = {}
        self.on_data = on_data

    def add_port(self, port: str, node_id: int, baud_rate: int = 115200):
        """Add a serial port to listen on."""
        listener = SerialListener(
            port=port,
            baud_rate=baud_rate,
            on_data=self.on_data,
            node_id=node_id,
        )
        self.listeners[port] = listener

    def start_all(self):
        """Start all registered listeners."""
        for listener in self.listeners.values():
            listener.start()

    def stop_all(self):
        """Stop all listeners."""
        for listener in self.listeners.values():
            listener.stop()

    def get_status(self) -> dict:
        """Return the status of all serial connections."""
        return {
            port: {
                "node_id": listener.node_id,
                "connected": listener.connected,
                "last_received": (
                    listener.last_received.isoformat()
                    if listener.last_received else None
                ),
                "packet_count": listener.packet_count,
                "error_count": listener.error_count,
                "clock_offset_ms": listener.clock_offset_ms,
            }
            for port, listener in self.listeners.items()
        }

    def auto_discover(self) -> list[str]:
        """
        Attempt to discover Arduino serial ports.
        Returns list of likely port paths.
        """
        ports = []
        try:
            import serial.tools.list_ports
            for port_info in serial.tools.list_ports.comports():
                desc = (port_info.description or "").lower()
                mfg = (port_info.manufacturer or "").lower()
                # Look for Arduino-like devices
                if any(
                    keyword in desc or keyword in mfg
                    for keyword in ["arduino", "ch340", "cp210", "ftdi", "usb serial"]
                ):
                    ports.append(port_info.device)
                    logger.info(
                        f"Discovered Arduino-like device: {port_info.device} "
                        f"({port_info.description})"
                    )
        except ImportError:
            logger.warning("pyserial not installed, cannot auto-discover ports")
        except Exception as e:
            logger.warning(f"Port discovery error: {e}")

        return ports
