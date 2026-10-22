// Serves the verified production build (dist/) — same server, STATIC_DIR=dist.
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 5173;
createApp({ staticDir: 'dist' }).listen(port, () => console.log(`PlanB Orchestra (production build) at http://localhost:${port}`));
