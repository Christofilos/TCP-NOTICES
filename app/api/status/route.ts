// Last reminder run and the list of emails sent. Needs the team password.
import { status } from '../../../lib/server/handlers';

export const maxDuration = 30;

export async function GET(req: Request) { return status(req); }
