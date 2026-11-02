import React, { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { MessagingWorkspace } from '../messaging/MessagingWorkspace';

/**
 * Messaging page shared by every role dashboard.
 *
 * The backend owns conversation visibility (`chat.access.can_communicate`), so
 * this page renders the same interface for farmers, wholesalers, retailers,
 * drivers and every administrative role; the API decides what exists.
 */
export const MessagingView: React.FC = () => {
  const location = useLocation();

  // Support deep links such as `/messaging?with=<userId>&name=<name>` from
  // order and listing screens.
  const initialPartner = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('with');
    if (!id) return null;
    return { id, name: params.get('name') || '' };
  }, [location.search]);

  return <MessagingWorkspace initialPartner={initialPartner} />;
};

export default MessagingView;
