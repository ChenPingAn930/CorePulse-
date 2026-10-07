import type { UserProfile } from '../types';
import { fetchProfile } from '../api';

const ICO = (name: string): string =>
  (window as Window & { __ICONS?: Record<string, string> }).__ICONS?.[name] ?? '';

/** 我的（个人中心）视图 */
export class ProfileView {
  readonly root: HTMLElement;

  constructor() {
    this.root = document.createElement('section');
    this.root.className = 'view';
    this.root.id = 'view-profile';
  }

  async mount(): Promise<void> {
    const profile = await fetchProfile();
    this.render(profile);
  }

  private render(p: UserProfile): void {
    this.root.innerHTML = `
      <div class="page-head">
        <div class="page-title">
          <span class="title-ico">${ICO('profile')}</span>
          我的
        </div>
        <div class="page-sub">管理你的账号信息与偏好设置</div>
      </div>
      <div class="profile-card">
        <div class="avatar-large">${p.avatarChar}</div>
        <h3>${p.name}</h3>
        <div class="field"><span class="label">账号 ID</span><span>${p.accountId}</span></div>
        <div class="field"><span class="label">邮箱</span><span>${p.email}</span></div>
        <div class="field"><span class="label">API 密钥</span><span>${p.apiKey}</span></div>
        <div class="field"><span class="label">注册时间</span><span>${p.registeredAt}</span></div>
        <div class="actions">
          <button class="btn-primary" id="settingsBtn">${ICO('settings')}偏好设置</button>
          <button class="btn-outline" id="logoutBtn">退出</button>
        </div>
      </div>`;

    this.root.querySelector('#settingsBtn')?.addEventListener('click', () => {
      window.alert('偏好设置 (模拟)');
    });
    this.root.querySelector('#logoutBtn')?.addEventListener('click', () => {
      window.alert('退出登录 (模拟)');
    });
  }
}
