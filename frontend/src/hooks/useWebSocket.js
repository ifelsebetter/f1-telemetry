import { useState, useEffect, useRef, useCallback } from 'react';

const WS_PING_INTERVAL = 25000;
const WS_MAX_RECONNECT_DELAY = 30000;
const WS_INITIAL_RECONNECT_DELAY = 1000;
const WS_MAX_MESSAGE_SIZE = 1048576; // 1 MB safety limit

/**
 * Custom hook for WebSocket connection management.
 *
 * Features:
 * - Auto-reconnect with exponential backoff (1s → 30s cap)
 * - Heartbeat ping every 25 seconds
 * - Message size validation
 * - Clean up on unmount
 *
 * @param {string} url - WebSocket URL to connect to
 * @returns {{ status: string, lastMessage: object|null, sendMessage: function }}
 */
export function useWebSocket(url) {
  const [status, setStatus] = useState('disconnected');
  const [lastMessage, setLastMessage] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const mountedRef = useRef(true);
  const urlRef = useRef(url);
  urlRef.current = url;

  const clearTimers = useCallback(() => {
    if (reconnectTimeoutRef.current != null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pingIntervalRef.current != null) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  const closeSocket = useCallback((ws) => {
    if (!ws) return;
    ws.onopen = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }, []);

  const sendMessage = useCallback((data) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let currentReconnectDelay = WS_INITIAL_RECONNECT_DELAY;

    function scheduleReconnect() {
      if (!mountedRef.current) return;

      if (reconnectTimeoutRef.current != null) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      const delay = currentReconnectDelay;
      reconnectTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connect();
        }
      }, delay);

      currentReconnectDelay = Math.min(delay * 2, WS_MAX_RECONNECT_DELAY);
    }

    function connect() {
      if (!mountedRef.current) return;

      clearTimers();
      closeSocket(wsRef.current);

      setStatus('connecting');

      let ws;
      try {
        ws = new WebSocket(urlRef.current);
      } catch {
        setStatus('error');
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { closeSocket(ws); return; }
        setStatus('connected');
        currentReconnectDelay = WS_INITIAL_RECONNECT_DELAY;

        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, WS_PING_INTERVAL);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;

        // Message size and type guard
        if (typeof event.data !== 'string' || event.data.length > WS_MAX_MESSAGE_SIZE) {
          return;
        }

        try {
          const data = JSON.parse(event.data);

          // Validate message is a plain object
          if (data == null || typeof data !== 'object' || Array.isArray(data)) return;

          // Ignore heartbeat responses
          if (data.type === 'pong' || data.type === 'filters_updated') return;

          setLastMessage(data);
        } catch {
          // Non-JSON message — discard silently
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setStatus('disconnected');
        clearTimers();
        scheduleReconnect();
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setStatus('error');
        // onclose fires after onerror and handles reconnect
      };
    }

    connect();

    return () => {
      mountedRef.current = false;
      clearTimers();
      closeSocket(wsRef.current);
      wsRef.current = null;
    };
  }, [clearTimers, closeSocket]);

  return { status, lastMessage, sendMessage };
}
