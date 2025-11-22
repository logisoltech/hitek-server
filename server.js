const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const orderRoutes = require('./routes/orders');
const laptopRoutes = require('./routes/laptops');
const printerRoutes = require('./routes/printers');
const productRoutes = require('./routes/products');
const cmsAuthRoutes = require('./routes/cmsAuth');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(
  cors({
    origin: [
      'https://hitek.vercel.app',
      'https://hitek.vercel.app/',
      'http://localhost:3000'
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/laptops', laptopRoutes);
app.use('/api/printers', printerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cms', cmsAuthRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

