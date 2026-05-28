require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { init } = require('./db');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/products',  require('./routes/products'));
app.use('/api/jobs',      require('./routes/jobs'));
app.use('/api/platforms', require('./routes/platforms'));
app.use('/api/seatos',    require('./routes/seatos'));

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '../dashboard/dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = process.env.PORT || 3000;

init()
  .then(() => app.listen(PORT, () => console.log(`Server listening on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
