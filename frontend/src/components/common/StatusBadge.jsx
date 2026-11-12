import React from 'react';
import { Badge } from './Badge';

const CAMPAIGN_STATUS_MAP = {
  INITIALIZED: { label: 'Initialized', variant: 'neutral', dot: false },
  QUEUED: { label: 'Queued', variant: 'info', dot: true },
  EXTRACTING_PRODUCT: { label: 'Extracting Product', variant: 'purple', dot: true },
  ANALYZING_PRODUCT: { label: 'Analyzing Product', variant: 'purple', dot: true },
  GENERATING_STRATEGY: { label: 'Generating Strategy', variant: 'purple', dot: true },
  PLANNING_CREATIVES: { label: 'Planning Creatives', variant: 'purple', dot: true },
  GENERATING_ASSETS: { label: 'Generating Assets', variant: 'warning', dot: true },
  EVALUATING_CREATIVES: { label: 'Evaluating QA', variant: 'warning', dot: true },
  GENERATING_COPY: { label: 'Writing Ad Copy', variant: 'purple', dot: true },
  ASSEMBLING_CAMPAIGN: { label: 'Assembling Campaign', variant: 'info', dot: true },
  COMPLETED: { label: 'Completed', variant: 'success', dot: false },
  FAILED: { label: 'Failed', variant: 'error', dot: false },
};

const APPROVAL_STATUS_MAP = {
  approved: { label: 'Approved', variant: 'success', dot: false },
  rejected: { label: 'Rejected', variant: 'error', dot: false },
  needs_review: { label: 'Needs Review', variant: 'warning', dot: false },
  pending: { label: 'Pending QA', variant: 'neutral', dot: false },
};

export function StatusBadge({ status, kind = 'campaign', size = 'sm' }) {
  const map = kind === 'approval' ? APPROVAL_STATUS_MAP : CAMPAIGN_STATUS_MAP;
  const info = map[status] || { label: status || 'Unknown', variant: 'neutral', dot: false };

  return (
    <Badge variant={info.variant} size={size} dot={info.dot}>
      {info.label}
    </Badge>
  );
}

export function isCampaignInFlight(status) {
  return Boolean(
    status &&
      !['COMPLETED', 'FAILED', 'INITIALIZED'].includes(status)
  );
}

