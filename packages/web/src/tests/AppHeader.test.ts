import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import AppHeader from '../components/layout/AppHeader.vue'

// Mock composables
vi.mock('@/composables/useNewProjectDialog', () => ({
  useNewProjectDialog: () => ({
    open,
  }),
}))

describe('AppHeader.vue', () => {
  it('renders the title', () => {
    const wrapper = mount(AppHeader, {
      props: {
        title: 'Test Title',
      },
    })
    expect(wrapper.text()).toContain('Test Title')
  })

  it('calls the open function when the "New Project" button is clicked', async () => {
    const wrapper = mount(AppHeader, {
      props: {
        title: 'Test Title',
      },
    })

    const button = wrapper.find('button')
    await button.trigger('click')

    expect(open).toHaveBeenCalled()
  })
})