import { createApp, lakebase, server } from '@databricks/appkit';
import { setupDatabase } from './db/setup';
import { registerApiRoutes } from './routes/api';

createApp({
  plugins: [lakebase(), server()],
  async onPluginsReady(appkit) {
    try {
      await setupDatabase(appkit.lakebase);
    } catch (err) {
      console.error('[cpm] Database setup failed:', (err as Error).message);
      console.error('[cpm] If this is "permission denied for schema", deploy the app first so its service principal owns the schema.');
    }
    registerApiRoutes(appkit);
  },
}).catch(console.error);
