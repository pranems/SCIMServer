import React from 'react';
import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  root: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' },
  toolbar: {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px',
    backgroundColor: tokens.colorNeutralBackground1, minWidth: 0,
    '& > *': { maxWidth: '100%', minWidth: 0 },
  },
  results: {
    minWidth: 0, maxHeight: '420px', overflow: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  fillRoot: { flex: 1, minHeight: 0 },
  fillResults: { flex: 1, minHeight: 0, maxHeight: 'none' },
});

/** The toolbar is outside the scroll owner, so neither axis can hide it. */
export const FilteredResultsPanel: React.FC<{
  toolbar: React.ReactNode;
  children: React.ReactNode;
  label: string;
  fillHeight?: boolean;
  'data-testid': string;
}> = ({ toolbar, children, label, fillHeight = false, 'data-testid': testId }) => {
  const classes = useStyles();
  return (
    <div className={mergeClasses(classes.root, fillHeight && classes.fillRoot)}>
      <div className={classes.toolbar} role="group" aria-label={`${label} filters`} data-testid={`${testId}-filters`}>
        {toolbar}
      </div>
      <div className={mergeClasses(classes.results, fillHeight && classes.fillResults)} role="region" aria-label={label} tabIndex={0} data-testid={testId}>
        {children}
      </div>
    </div>
  );
};
