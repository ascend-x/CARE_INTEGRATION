import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * WebSocket hook for real-time data from the CARE server.
 * Manages connection, reconnection, and message dispatch.
 */
export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [beds, setBeds] = useState({});
  const [incidents, setIncidents] = useState({});
  const [escalations, setEscalations] = useState([]);
  const [lastMessage, setLastMessage] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const reconnectAttempts = useRef(0);

  const connect = useCallback(() => {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const url = `${protocol}//${host}/ws/live`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectAttempts.current = 0;
        console.log('[CARE WS] Connected');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          setLastMessage(msg);

          switch (msg.type) {
            case 'init':
              setBeds(msg.data.beds || {});
              break;

            case 'vitals':
              setBeds(prev => {
                const bedId = msg.data.bed_id;
                return {
                  ...prev,
                  [bedId]: {
                    ...prev[bedId],
                    vitals: msg.data,
                    node_status: msg.data.node_status,
                    signal_quality: msg.data.signal_quality,
                    planned_activity: msg.data.planned_activity,
                  },
                };
              });
              break;

            case 'incidents':
              setIncidents(prev => ({
                ...prev,
                [msg.data.bed_id]: msg.data.incidents,
              }));
              break;

            case 'escalation':
              setEscalations(prev => [...prev.slice(-20), msg.data]);
              break;

            case 'incident_ack':
            case 'incident_resolved':
              // These will be reflected in the next incidents update
              break;

            case 'planned_activity':
              setBeds(prev => {
                const bedId = msg.data.bed_id;
                return {
                  ...prev,
                  [bedId]: {
                    ...prev[bedId],
                    planned_activity: msg.data.active,
                    planned_activity_type: msg.data.activity_type,
                  },
                };
              });
              break;

            case 'scenario_triggered':
              console.log('[CARE WS] Scenario triggered:', msg.data);
              break;

            case 'pong':
              break;

            default:
              console.log('[CARE WS] Unknown message type:', msg.type);
          }
        } catch (e) {
          console.error('[CARE WS] Parse error:', e);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        console.log('[CARE WS] Disconnected');

        // Reconnect with backoff
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
        reconnectAttempts.current++;
        reconnectTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = (err) => {
        console.error('[CARE WS] Error:', err);
      };

    } catch (e) {
      console.error('[CARE WS] Connection failed:', e);
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
      reconnectAttempts.current++;
      reconnectTimer.current = setTimeout(connect, delay);
    }
  }, []);

  useEffect(() => {
    connect();

    // Ping interval to keep connection alive
    const pingInterval = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => {
      clearInterval(pingInterval);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  return {
    connected,
    beds,
    incidents,
    escalations,
    lastMessage,
  };
}
