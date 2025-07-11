import LinearProgress from '@mui/material/LinearProgress';
import { styled } from '@mui/material/styles';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import MainLayout from './layouts/mainLayout';
import { type LazyExoticComponent, Suspense, forwardRef, lazy } from 'react';
import { type JSX } from 'react/jsx-runtime';

const LoaderWrapper = styled('div')({
  position: 'fixed',
  top: 0,
  left: 0,
  zIndex: 1301,
  width: '100%',
});

const Loader = () => (
  <LoaderWrapper>
    <LinearProgress color='primary' />
  </LoaderWrapper>
);

const LazyLoadable = (
  Component: LazyExoticComponent<() => JSX.Element>
): React.ForwardRefExoticComponent<any> =>
  forwardRef((props: any, ref: React.Ref<any>) => (
    <Suspense fallback={<Loader />}>
      <Component {...props} ref={ref} />
    </Suspense>
  ));

const Dashboard = LazyLoadable(lazy(() => import('@/pages/dashboard')));
const Chat = LazyLoadable(lazy(() => import('@/pages/chat')));
const Completion = LazyLoadable(lazy(() => import('@/pages/completion')));
const Model = LazyLoadable(lazy(() => import('@/pages/model')));
const User = LazyLoadable(lazy(() => import('@/pages/user-management')));
const Admin = LazyLoadable(lazy(() => import('@/pages/admin')));
const Invite = LazyLoadable(lazy(() => import('@/pages/invite')));
const Auth = LazyLoadable(lazy(() => import('@/pages/auth')));
const Login = LazyLoadable(lazy(() => import('@/pages/login')));
const UserLogin = LazyLoadable(lazy(() => import('@/pages/user/login')));
const Expectation = LazyLoadable(lazy(() => import('@/pages/expectation')));
const UserChat = LazyLoadable(lazy(() => import('@/pages/user/chat')));
const UserCompletion = LazyLoadable(
  lazy(() => import('@/pages/user/completion'))
);

const UserDashboard = LazyLoadable(
  lazy(() => import('@/pages/user/dashboard'))
);

const routerConfig = [
  {
    path: '/',
    element: <MainLayout />,
    children: [
      {
        index: true,
        element: <Navigate to='/dashboard' replace />,
      },
      {
        path: 'dashboard/:tab?/:id?',
        element: <Dashboard />,
      },
      {
        path: 'chat',
        element: <Chat />,
      },
      {
        path: 'code-security',
        element: <Expectation />,
      },
      {
        path: 'completion',
        element: <Completion />,
      },
      {
        path: 'model',
        element: <Model />,
      },
      {
        path: 'user-management',
        element: <User />,
      },
      {
        path: 'admin',
        element: <Admin />,
      },
    ],
  },

  {
    path: '/user',
    element: <MainLayout />,
    children: [
      {
        index: true,
        element: <Navigate to='/user/dashboard' replace />,
      },
      {
        path: 'dashboard',
        element: <UserDashboard />,
      },
      {
        path: 'chat',
        element: <UserChat />,
      },
      {
        path: 'completion',
        element: <UserCompletion />,
      },
    ],
  },
  {
    path: '/invite/:id/:step?',
    element: <Invite />,
  },
  {
    path: '/auth',
    element: <Auth />,
  },
  {
    path: '/user/login',
    element: <UserLogin />,
  },
  {
    path: '/login',
    element: <Login />,
  },
];

const router = createBrowserRouter(routerConfig, {});

export default router;
