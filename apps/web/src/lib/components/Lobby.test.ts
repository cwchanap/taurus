// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import Lobby from './Lobby.svelte'

afterEach(() => {
  cleanup()
})

describe('Lobby', () => {
  it('shows errors, forwards name changes, and handles room creation state', async () => {
    const onCreateRoom = vi.fn()
    const onJoinRoom = vi.fn()
    const onPlayerNameChange = vi.fn()
    const props = {
      onCreateRoom,
      onJoinRoom,
      playerName: '',
      onPlayerNameChange,
      isLoading: false,
      errorMessage: 'Room unavailable',
    }
    const { rerender } = render(Lobby, props)

    expect(screen.getByRole('alert').textContent).toContain('Room unavailable')

    const nameInput = screen.getByLabelText('Your Name')
    await fireEvent.input(nameInput, { target: { value: 'Alice' } })
    expect(onPlayerNameChange).toHaveBeenCalledWith('Alice')

    const createButton = screen.getByRole('button', { name: 'Create Room' }) as HTMLButtonElement
    expect(createButton.disabled).toBe(true)

    await rerender({
      ...props,
      playerName: 'Alice',
      isLoading: true,
      errorMessage: undefined,
    })

    const creatingButton = screen.getByRole('button', { name: 'Creating...' }) as HTMLButtonElement
    expect(creatingButton.disabled).toBe(true)

    await rerender({
      ...props,
      playerName: 'Alice',
      isLoading: false,
      errorMessage: undefined,
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Create Room' }))
    expect(onCreateRoom).toHaveBeenCalledTimes(1)
  })

  it('uppercases room codes before joining and keeps the join button disabled until ready', async () => {
    const onJoinRoom = vi.fn()
    render(Lobby, {
      onCreateRoom: vi.fn(),
      onJoinRoom,
      playerName: 'Alice',
      onPlayerNameChange: vi.fn(),
      isLoading: false,
    })

    const joinButton = screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement
    expect(joinButton.disabled).toBe(true)

    const roomCodeInput = screen.getByLabelText('Room Code') as HTMLInputElement
    await fireEvent.input(roomCodeInput, { target: { value: 'ab12cd34ef56' } })
    expect(roomCodeInput.value).toBe('ab12cd34ef56')
    expect(joinButton.disabled).toBe(false)

    await fireEvent.click(joinButton)
    expect(onJoinRoom).toHaveBeenCalledWith('AB12CD34EF56')
  })
})
