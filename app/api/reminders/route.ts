// Page buttons: preview or send today's reminders now. Needs the team password.
import { reminders } from '../../../lib/server/handlers';

export const maxDuration = 60;

export async function POST(req: Request) { return reminders(req); }
