/* eslint-disable header/header */

/**
 * Simple WebSocket server for DocNode collaboration
 * Similar to y-websocket-server but for DocNode operations
 */

import {WebSocketServer} from 'ws';

const PORT = process.env.PORT || 1235;
const HOST = process.env.HOST || 'localhost';

// Store full operation history (received from clients)
const operationHistory = [];

// Store clients: Set<WebSocket>
const clients = new Set();

console.log('DocNode server initialized (no initial state)');

const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
});

console.log(`DocNode WebSocket server running on ws://${HOST}:${PORT}`);

wss.on('connection', (ws) => {
  clients.add(ws);

  console.log('Client connected', {
    clientCount: clients.size,
    operationHistoryLength: operationHistory.length,
  });

  // Send full operation history to the new client
  ws.send(
    JSON.stringify({
      operations: operationHistory,
      type: 'sync',
    }),
  );

  console.log(`Sent to client ${operationHistory.length} operations`);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'operation') {
        // Store operation in history
        operationHistory.push(message.operation);

        // Broadcast to ALL other clients (exclude sender)
        const broadcastMessage = JSON.stringify({
          clientId: message.clientId,
          operation: message.operation,
          type: 'operation',
        });

        let broadcastCount = 0;
        clients.forEach((client) => {
          if (client !== ws && client.readyState === 1) {
            client.send(broadcastMessage);
            broadcastCount++;
          }
        });
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

wss.on('error', (error) => {
  console.error('WebSocketServer error:', error);
});

process.on('SIGINT', () => {
  console.log('\nShutting down DocNode WebSocket server...');
  wss.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
