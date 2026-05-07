import React from 'react';
import { render, screen } from '@testing-library/react-native';
import LandingPage from '../app/index';

describe('LandingPage', () => {
  it('renders the app name', () => {
    render(<LandingPage />);
    expect(screen.getByText('ai3-mvp')).toBeTruthy();
  });

  it('renders the commands table with help, echo, and check', () => {
    render(<LandingPage />);
    expect(screen.getByText('help')).toBeTruthy();
    expect(screen.getByText('echo')).toBeTruthy();
    expect(screen.getByText('check')).toBeTruthy();
    expect(screen.getByText('Show available commands')).toBeTruthy();
    expect(screen.getByText('Echo back your message')).toBeTruthy();
    expect(screen.getByText('Run CI checks on the current PR')).toBeTruthy();
  });

  it('renders the authorize button', () => {
    render(<LandingPage />);
    expect(screen.getByText('Authorize with GitHub')).toBeTruthy();
  });
});
