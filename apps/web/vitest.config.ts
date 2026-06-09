import { defineConfig } from 'vitest/config';
import { webProjects } from './vitest.projects';

export default defineConfig({ test: { projects: webProjects } });
