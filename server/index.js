const { createApp } = require('./app');
const { server, cfg } = createApp();
server.listen(cfg.port, () => console.log(`Pulse running on http://localhost:${cfg.port}`));
