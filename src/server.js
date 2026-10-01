require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocket } = require('./realtime/socket');
const { resetPresence, startMaintenance } = require('./services/maintenance.service');

const PORT = process.env.PORT || 3000;

// Socket.io Express'ning http serveriga ulanadi — bitta process, bitta port
// (SRS'dagi "bitta monolit backend" tavsiyasiga mos).
const httpServer = http.createServer(app);
const io = initSocket(httpServer);
app.set('io', io);

// Holatlar ulanishlar qabul qilinishidan OLDIN tiklanadi — aks holda endigina
// ulangan foydalanuvchining "online" belgisi ustidan yozib yuborilishi mumkin.
resetPresence()
    .catch((err) => console.error('Holatlarni tiklashda xato:', err.message))
    .finally(() => {
        httpServer.listen(PORT, () => {
            console.log(`Solvi backend ${PORT}-portda ishga tushdi`);
            startMaintenance();
        });
    });
