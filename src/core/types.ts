export const DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
export type Day = (typeof DAYS)[number];

export const SESSION_TYPES = ['Lec', 'Sec', 'Lab'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const MIN_PERIOD = 1;
export const MAX_PERIOD = 16;

export interface Session {
  day: Day;
  from: number;
  to: number;
  type: SessionType;
  lecturer: string;
}

export interface Group {
  id: string;
  portalLabel: string;
  pageLabel: string;
  open: boolean;
  sessions: Session[];
}

export interface Course {
  code: string;
  name: string;
  current: string | null;
  groups: Group[];
}

export interface Dataset {
  schemaVersion: 1;
  source: 'portal' | 'pdf' | 'import';
  fetchedAt: string;
  term: string;
  courses: Course[];
}
