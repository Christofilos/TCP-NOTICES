// GET: read the team data. PUT or POST: save it. Needs the team password.
import { getState, putState } from '../../../lib/server/handlers';

export const maxDuration = 30;

export async function GET(req: Request) { return getState(req); }
export async function PUT(req: Request) { return putState(req); }
export async function POST(req: Request) { return putState(req); }
