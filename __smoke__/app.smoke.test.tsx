// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';

/** 加几行使根不是叶子，这样查找有多步可回放 */
function addRow(id: string, name: string, age: string) {
  fireEvent.change(screen.getByPlaceholderText('ID'), { target: { value: id } });
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: name } });
  fireEvent.change(screen.getByPlaceholderText('Age'), { target: { value: age } });
  fireEvent.click(screen.getByRole('button', { name: /Insert|插入数据/ }));
}

describe('App smoke', () => {
  it('renders the visualizer shell', () => {
    render(<App />);
    expect(screen.getAllByText(/InnoDB/i).length).toBeGreaterThan(0);
  });

  it('输入键后逐步回放并标出命中', async () => {
    render(<App />);
    addRow('20', 'x', '40');
    addRow('25', 'y', '45');
    fireEvent.change(screen.getByPlaceholderText('id'), { target: { value: '10' } });
    fireEvent.click(screen.getByText('走一遍'));

    await waitFor(() => expect(document.body.textContent).toContain('在 ['));
    await waitFor(() => expect(document.body.textContent).toContain('命中'));
  });

  it('查不存在的键时标未命中', async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('id'), { target: { value: '999' } });
    fireEvent.click(screen.getByText('走一遍'));
    await waitFor(() => expect(document.body.textContent).toContain('未命中'));
  });

  it('切到教科书画法后图例文案翻面', () => {
    render(<App />);
    fireEvent.click(screen.getByText('教科书'));
    expect(document.body.textContent).toContain('内部页存的是左侧子页的最大键');
  });

  it('回放中可跳过', async () => {
    render(<App />);
    addRow('20', 'x', '40');
    addRow('25', 'y', '45');
    fireEvent.change(screen.getByPlaceholderText('id'), { target: { value: '10' } });
    fireEvent.click(screen.getByText('走一遍'));
    const skip = await screen.findByText('跳过');
    fireEvent.click(skip);
    await waitFor(() => expect(document.body.textContent).toContain('命中'));
  });
});
