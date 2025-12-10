/* eslint-disable header/header */

/**
 * Simple WebSocket server for DocNode collaboration
 * Similar to y-websocket-server but for DocNode operations
 */

import {WebSocketServer} from 'ws';

const PORT = process.env.PORT || 1235;
const HOST = process.env.HOST || 'localhost';

// Store documents per room: roomId -> {operations: [], clients: Set<WebSocket>}
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      clients: new Set(),
      operations: [],
    });
  }
  return rooms.get(roomId);
}

const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
});

// Increase max listeners for development (HMR may cause multiple reloads)
wss.setMaxListeners(20);

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `ws://${HOST}:${PORT}`);
  const roomId = url.pathname.slice(1); // Remove leading '/'

  if (!roomId) {
    ws.close(1008, 'Room ID is required');
    return;
  }

  const room = getRoom(roomId);
  room.clients.add(ws);

  // Send full operation history to the new client
  ws.send(
    JSON.stringify({
      operations: room.operations,
      type: 'sync',
    }),
  );

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'operation') {
        // Store operation in room history
        room.operations.push(message.operation);

        // Broadcast to ALL other clients in the room (exclude sender)
        const broadcastMessage = JSON.stringify({
          clientId: message.clientId,
          operation: message.operation,
          type: 'operation',
        });

        room.clients.forEach((client) => {
          if (client !== ws && client.readyState === 1) {
            client.send(broadcastMessage);
          }
        });
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);

    // Clean up empty rooms
    if (room.clients.size === 0) {
      rooms.delete(roomId);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

wss.on('error', (error) => {
  console.error('WebSocketServer error:', error);
});

// Use .once() to prevent multiple registrations during HMR
process.once('SIGINT', () => {
  // eslint-disable-next-line no-console
  console.log('\nShutting down DocNode WebSocket server...');
  wss.close(() => {
    // eslint-disable-next-line no-console
    console.log('Server closed');
    process.exit(0);
  });
});

process.once('SIGTERM', () => {
  // eslint-disable-next-line no-console
  console.log('\nShutting down DocNode WebSocket server...');
  wss.close(() => {
    // eslint-disable-next-line no-console
    console.log('Server closed');
    process.exit(0);
  });
});
