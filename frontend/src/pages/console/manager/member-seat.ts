export type LicenseSeatStatus = {
  seats?: number;
  used_seats?: number;
  limits?: {
    max_members?: number;
  };
};

export function resolveMemberLimit(fallbackLimit: number, status?: LicenseSeatStatus | null) {
  return status?.limits?.max_members ?? status?.seats ?? fallbackLimit;
}

export function resolveUsedSeats(memberCount: number, status?: LicenseSeatStatus | null) {
  return status?.used_seats ?? memberCount;
}
