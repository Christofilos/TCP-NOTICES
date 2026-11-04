// Public: says which settings exist (never their values).
import { ping } from '../../../lib/server/handlers';

export const maxDuration = 30;

export async function GET() { return ping(); }
