import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { motion } from 'framer-motion';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import logoUrl from '@/assets/logo.png';

const Home: React.FC = () => {
  const c = useClaudeTokens();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100%',
        px: 2,
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.8 }}
      >
        <Box sx={{ maxWidth: 440, width: '100%', textAlign: 'center' }}>
          {/* Smaller, quieter mascot — was 48 px and the loudest thing
              on the screen. Claude Design's empty states let typography
              lead with a tiny visual accent. Asset is imported (vite
              bundles it) instead of `/logo.png` from public/ which
              404'd during the cold-start window. */}
          <Box
            component="img"
            src={logoUrl}
            alt=""
            sx={{
              width: 32,
              height: 32,
              objectFit: 'contain',
              mb: 2.5,
              opacity: 0.85,
            }}
          />
          <Typography
            sx={{
              fontWeight: 600,
              fontSize: '1.4rem',
              color: c.text.primary,
              mb: 1,
              // Inherit body sans — keeps the empty state consistent
              // with the rest of the template instead of jumping to a
              // serif headline.
              fontFamily: 'inherit',
              letterSpacing: '-0.02em',
            }}
          >
            OpenSwarm
          </Typography>
          <Typography
            sx={{
              fontSize: '0.9rem',
              color: c.text.tertiary,
              fontFamily: 'inherit',
              lineHeight: 1.55,
            }}
          >
            Web app template, ready to build.
          </Typography>
        </Box>
      </motion.div>
    </Box>
  );
};

export default Home;
