require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const app = express();

// Connect to MongoDB
connectDB();

// Middleware
const corsOptions = {
  origin: true, // reflect request origin — allows any origin including production frontend
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200, // some browsers (IE11) choke on 204
};
app.use(cors(corsOptions));
app.options('/{*path}', cors(corsOptions)); // handle preflight — Express 5 syntax
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/spaces', require('./routes/spaces'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/shopping-list', require('./routes/shoppingList'));
app.use('/api/schedule-events', require('./routes/scheduleEvents'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/drive', require('./routes/drive'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Expense Tracker API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
