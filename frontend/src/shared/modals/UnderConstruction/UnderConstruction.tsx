import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './UnderConstruction.module.scss';

const UnderConstruction = () => {
  const { t } = useTranslation();
  return (
    <div className={styles.under_construction_overlay}>
      <img src="/hammer-icon.png" alt={t('common.consoleIcon')} />
      <h2>{t('common.underConstruction')}</h2>
      <p>{t('common.featureComingSoon')}</p>
    </div>
  );
};

export { UnderConstruction };