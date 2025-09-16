import CardServiceSettings from './components/cardServiceSettings';
import { Grid } from '@mui/material';
import CardAdminUser from './components/cardAdminUser';
import Model from '@/pages/model';

const GeneralSetting = () => {
  return (
    <Grid container spacing={2} sx={{ height: '100%' }}>
      <Grid size={6}>
        <CardServiceSettings />
        <Model />
      </Grid>
      <Grid size={6}>
        <CardAdminUser />
      </Grid>
    </Grid>
  );
};

export default GeneralSetting;
