/** Public static deployments never mount the authenticated backend routes. */
export const rehearsalOnly = import.meta.env.VITE_REHEARSAL_ONLY === 'true';
