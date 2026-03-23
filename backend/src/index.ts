import 'reflect-metadata';
import app from './app.js';
import { startRuntime } from './lifecycle.js';

if (process.env.NODE_ENV !== 'test') {
  startRuntime();
}

export default app;