// orderProcessing.test.js
const http = require('http');
const socketIo = require('socket.io');
const { Server } = require('socket.io');
const request = require('supertest');
const express = require('express');
const ioClient = require('socket.io-client');
const app = require('./server');  // Assuming your code is in a file named app.js
const { server } = require('./server');

let clientSocket;

describe('Order Processing', () => {
  beforeAll((done) => {
    clientSocket = ioClient('http://localhost:3000');
    clientSocket.on('connect', done); 
  });

  afterAll((done) => {
    // Close the server and disconnect the socket after all tests are done
    clientSocket.disconnect();
    server.close(() => {
      console.log('Server closed successfully');
      done();
    });
  });

  afterEach(() => {
    // Cleanup after each test
    jest.clearAllTimers();  // Clear any fake timers that could be blocking the exit
  });

  it('should not process an order when no bots are available', async () => {
    clientSocket.emit('newNormalOrder');
    
    const orders = await new Promise((resolve) => {
      clientSocket.on('orderUpdated', resolve);
    });
    
    expect(orders.pendingOrders.length).toBe(1);  // First pending order
    expect(orders.processingOrders.length).toBe(0);  // No bots are available, so no processing
  });


  it('should add a VIP order to the "PENDING" area with priority over normal orders', (done) => {
    let orderUpdates = {};

    // Listen for order updates from the server
    clientSocket.on('orderUpdated', (data) => {
      orderUpdates = data;
    });

    clientSocket.emit('newNormalOrder');
    clientSocket.emit('newVIPOrder');
    
    setTimeout(() => {
      expect(orderUpdates.pendingOrders[0].type).toBe('VIP');  // VIP order should be first
      expect(orderUpdates.pendingOrders[1].type).toBe('Normal');  // Normal order should be second
      done();
    }, 100);
  });

  it('should add a bot and start processing the first VIP order', async () => {
    clientSocket.emit('addBot');
    
    const [bots, orders] = await Promise.all([
      new Promise((resolve) => clientSocket.once('botUpdated', resolve)),
      new Promise((resolve) => clientSocket.once('orderUpdated', resolve))
    ]);
    
    expect(bots.length).toBe(1); // Start with one bot
    expect(orders.processingOrders.length).toBe(1); // Move first order to "PROCESSING" area
    expect(orders.processingOrders[0].type).toBe("VIP"); // First processing order should be VIP order
  });

  it('should move first VIP order to "COMPLETED" area after 10 seconds and immediately process next order', (done) => {
    let orderUpdates = {};

    // Listen for order updates from the server
    clientSocket.on('orderUpdated', (data) => {
      orderUpdates = data;
    });

    setTimeout(() => {
      expect(orderUpdates.completedOrders[0].type).toBe('VIP'); // VIP order moved to "COMPLETED" area
      expect(orderUpdates.processingOrders.length).toBe(1); // Bot processes next order
      done();
    }, 10000);
  });

  it('should move second NORMAL order to "COMPLETED" area after 10 seconds and immediately process next order', (done) => {
    let orderUpdates = {};

    // Listen for order updates from the server
    clientSocket.on('orderUpdated', (data) => {
      orderUpdates = data;
    });
    
    setTimeout(() => {
      expect(orderUpdates.completedOrders[1].type).toBe('Normal'); // Normal order finished processing and moved to "COMPLETED" area
      expect(orderUpdates.pendingOrders.length).toBe(0); // No more pending orders
      expect(orderUpdates.processingOrders.length).toBe(1); // Pending order moved to "PROCESSING" area
      done();
    }, 10000);
  });

  it('should remove a bot and move the processed order back to "PENDING" area', async () => {
    clientSocket.emit('removeBot');

    const [bots, orders] = await Promise.all([
      new Promise((resolve) => clientSocket.once('botUpdated', resolve)),
      new Promise((resolve) => clientSocket.once('orderUpdated', resolve))
    ]);
    
    expect(bots.length).toBe(0); // No more bot
    expect(orders.pendingOrders.length).toBe(1); // Previous processed order was sent back to "PENDING" area
  });

  it('should show idle after last order finish processing', (done) => {
    clientSocket.emit('addBot');

    let botUpdates = {};
    let orderUpdates = {};

    clientSocket.on('botUpdated', (data) => {
      botUpdates = data;
    });

    clientSocket.on('orderUpdated', (data) => {
      orderUpdates = data;
    });

    setTimeout(() => {
      expect(orderUpdates.pendingOrders.length).toBe(0); // No more pending orders
      expect(orderUpdates.processingOrders.length).toBe(0);  // No more processing orders
      expect(botUpdates[0].isIdle).toBe(true); // Bot status is now idle
      done();
    }, 11000);
  });
});

