export type DefaultDuration = 'until-revoked' | 'hour' | 'day';

export const defaultDurationKey = 'lanvory.default-grant-duration';

export function readDefaultDuration(): DefaultDuration {
  try {
    const val = localStorage.getItem(defaultDurationKey);
    return val === 'hour' || val === 'day' ? val : 'until-revoked';
  } catch {
    return 'until-revoked';
  }
}

export function saveDefaultDuration(duration: DefaultDuration): boolean {
  try {
    localStorage.setItem(defaultDurationKey, duration);
    return true;
  } catch {
    return false;
  }
}
