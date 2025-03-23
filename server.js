const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let pendingOrders = [];  // Orders waiting to be processed
let processingOrders = [];  // Orders currently being processed
let completedOrders = [];  // Orders that have been processed
let bots = [];  // List of active bots
let timeoutsMap = new Map(); // Map to hold each timeout
let orderId = 1;  // Counter to generate unique order numbers
let botId = 1;  // Counter to generate unique bot numbers


// Serve the client HTML
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Function to start processing orders
function processOrder(bot) {
  if (pendingOrders.length > 0 && bot.isIdle) {
    bot.isIdle = false; // Change bot's state to processing
    io.emit('botUpdated', bots); // Update bot status to all clients
    const order = pendingOrders.shift();  // Get the first order in the queue
    processingOrders.push(order); // Move the order to the PROCESSING area
    io.emit('orderUpdated', { pendingOrders, processingOrders, completedOrders });

    const timeout = setTimeout(() => {
      if (processingOrders.some(item => item.id === order.id)) { // only move order to COMPLETED area if it exists in PROCESSING area
        completedOrders.push(order);  // Move the order to the COMPLETED area
        processingOrders = processingOrders.filter(o => o.id !== order.id);  // Remove from PROCESSING area
        io.emit('orderUpdated', { pendingOrders, processingOrders, completedOrders });
        bot.isIdle = true;

        // After completing an order, check if there are more pending orders
        if (pendingOrders.length > 0) {
          // If there are more orders, process the next one
          bots.forEach(bot => {
            if (bot.isIdle) {
              processOrder(bot);  // Start processing the next pending order
              return;  // Exit loop after assigning task to the first idle bot
            }
          });
        } else {
          bot.isIdle = true;  // No more orders, so bot becomes idle
          io.emit('botUpdated', bots); // Update bot status to all clients
        }
      }
    }, 10000);  // Each order takes 10 seconds to process

    timeoutsMap.set(order.id, timeout);
  }
}

// Handling connections from clients
io.on('connection', (socket) => {
  console.log('A user connected');
  
  // Send current orders when a new client connects
  socket.emit('orderUpdated', { pendingOrders, processingOrders, completedOrders });

  // Add a new normal order
  socket.on('newNormalOrder', () => {
    const order = { id: orderId++, type: 'Normal' };
    pendingOrders.push(order);
    io.emit('orderUpdated', { pendingOrders, processingOrders, completedOrders });

    // Check for idle bots and start processing
    bots.forEach(bot => {
      if (bot.isIdle) {
        processOrder(bot);  // Start processing the new order immediately
        return; // Exit loop after assigning task to the first idle bot
      }
    });
  });

  // Add a new VIP order
  socket.on('newVIPOrder', () => {
    const order = { id: orderId++, type: 'VIP' };
    // VIP orders go in front of normal orders, behind other VIP orders
    const index = pendingOrders.findIndex(o => o.type !== 'VIP');
    if (index === -1) {
      pendingOrders.push(order);
    } else {
      pendingOrders.splice(index, 0, order);
    }
    io.emit('orderUpdated', { pendingOrders, processingOrders, completedOrders });

    // Check for idle bots and start processing
    bots.forEach(bot => {
      if (bot.isIdle) {
        processOrder(bot);  // Start processing the new order immediately
        return; // Exit loop after assigning task to the first idle bot
      }
    });
  });

  // Add a new bot
  socket.on('addBot', () => {
    const bot = { id: botId++, isIdle: true };
    bots.push(bot);
    io.emit('botUpdated', bots);

    // Check for pending orders and start processing if available
    if (pendingOrders.length > 0) {
      processOrder(bot);  // Start processing the first pending order immediately
    }
  });

  // Remove a bot
  socket.on('removeBot', () => {
    const bot = bots.pop();
    if (bot) {
      // If bot is processing, return the current order to pending
      if (!bot.isIdle && processingOrders.length > 0) {
        const order = processingOrders.pop();

        if (order.type === "VIP") {
          pendingOrders.unshift(order); // If is VIP, put back on first position
        } else {
          const index = pendingOrders.findIndex(o => o.type !== 'VIP');
          
          if (index === -1) {
            pendingOrders.push(order); 
          } else {
            pendingOrders.splice(index, 0, order);  // If not VIP, put after VIP
          }
        }
        
        io.emit('orderUpdated', { pendingOrders, processingOrders, completedOrders });
        
        const timeoutToDelete = timeoutsMap.get(order.id);
        if (timeoutToDelete) {
          clearTimeout(timeoutToDelete);  // Cancel the timeout
          console.log('Timeout for "' + order.id + '" cleared.');
        }

        // Re-check if there are idle bots and assign pending orders
        bots.forEach(bot => {
          if (bot.isIdle) {
            processOrder(bot);  // Start processing the next order immediately
            return;  // Exit loop after assigning task to the first idle bot
          }
        });
      }
      io.emit('botUpdated', bots);
    }
  });

  // Handle disconnections
  socket.on('disconnect', () => {
    // console.log('A user disconnected');
  });
});

// Start the server
server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});

module.exports = { server, io };