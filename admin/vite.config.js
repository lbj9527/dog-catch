import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '')
	const port = Number(env.VITE_DEV_PORT || env.PORT || 3001)

	return {
		plugins: [vue()],
		server: {
			port,
			open: true
		},
		build: {
			outDir: 'dist'
		}
	}
}) 