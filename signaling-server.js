// signaling-server.js
const WebSocket = require('ws');

const PORT = process.env.PORT || 3002;
const wss = new WebSocket.Server({ port: PORT });

let rooms = {}; // { roomId: [ws1, ws2, ...] }

wss.on('connection', function connection(ws) {
  ws.on('message', function incoming(message) {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      return;
    }
    const { type, room, payload } = data;

    if (type === 'join') {
      ws.room = room;
      rooms[room] = rooms[room] || [];
      rooms[room].push(ws);
      // Notify others in the room
      rooms[room].forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'peer-joined' }));
        }
      });
    } else if (type === 'signal' && ws.room && rooms[ws.room]) {
      // Relay signaling messages to all other peers in the room
      rooms[ws.room].forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'signal', payload }));
        }
      });
    }
  });

  ws.on('close', function () {
    if (ws.room && rooms[ws.room]) {
      rooms[ws.room] = rooms[ws.room].filter(client => client !== ws);
      if (rooms[ws.room].length === 0) delete rooms[ws.room];
    }
  });
});

console.log(`Signaling server running on ws://localhost:${PORT}`);