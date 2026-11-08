import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
const crons = cronJobs();
crons.hourly(
  'expire history and backups',
  { minuteUTC: 17 },
  internal.maintenance.expireRetention,
  {},
);
export default crons;
