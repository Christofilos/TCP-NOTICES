// Sends one test email (at most 20 a day). Needs the team password.
import { testEmail } from '../../../lib/server/handlers';

export const maxDuration = 30;

export async function POST(req: Request) { return testEmail(req); }
