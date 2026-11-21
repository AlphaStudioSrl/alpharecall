import * as React from "react";

type FollowupsContextValue = {
  followups: string[];
  setFollowups: (items: string[]) => void;
};

const FollowupsContext = React.createContext<FollowupsContextValue | undefined>(undefined);

export function FollowupsProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: FollowupsContextValue;
}) {
  return <FollowupsContext.Provider value={value}>{children}</FollowupsContext.Provider>;
}

export function useFollowups() {
  const ctx = React.useContext(FollowupsContext);
  if (!ctx) {
    return { followups: [], setFollowups: () => {} } as FollowupsContextValue;
  }
  return ctx;
}
