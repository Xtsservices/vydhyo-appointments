const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require("body-parser");
require('dotenv').config();
const connectDB = require('./utils/db');
const logger = require('./utils/logger'); 
const appointmentRoutes = require('./routes/appointmentsRoutes');
const slotsRoutes = require('./routes/slotsRouter');
// Middleware
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(bodyParser.json());
// Connect to MongoDB
connectDB();
// Routes
app.use('/appointment', appointmentRoutes);
app.use('/appointment', slotsRoutes);


// Connect to MongoDB and start server
const PORT = process.env.PORT || 4005;
app.listen(PORT, () => logger.info(`Users Service running on port ${PORT}`));