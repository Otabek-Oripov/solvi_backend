require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocket } = require('./realtime/socket');

const PORT = process.env.PORT || 3000;

// Socket.io Express'ning http serveriga ulanadi — bitta process, bitta port
// (SRS'dagi "bitta monolit backend" tavsiyasiga mos).
const httpServer = http.createServer(app);
const io = initSocket(httpServer);
app.set('io', io);

httpServer.listen(PORT, () => {
    console.log(`Solvi backend ${PORT}-portda ishga tushdi`);
});
