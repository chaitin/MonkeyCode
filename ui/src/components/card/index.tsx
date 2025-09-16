import { styled } from '@mui/material';

const StyledCard = styled('div')(({ theme }) => ({
  padding: theme.spacing(2),
  borderRadius: (theme.shape.borderRadius as number) * 2.5,
  backgroundColor: theme.palette.background.default,
}));

export default StyledCard;
