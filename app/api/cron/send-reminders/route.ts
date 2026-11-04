// Called once a day by Vercel Cron (schedule in vercel.json). Needs Authorization: Bearer CRON_SECRET.
import { cron } from '../../../../lib/server/handlers';

export const maxDuration = 60;

export async function GET(req: Request) { return cron(req); }
