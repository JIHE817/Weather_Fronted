const CONFIG = {
    API_BASE_URL: 'http://10.19.240.108:5000/api/v1',
    TOKEN_KEY: 'access_token',
    USER_KEY: 'user_info'
};

const apiService = {
    getToken() { return localStorage.getItem(CONFIG.TOKEN_KEY); },
    setToken(token) { localStorage.setItem(CONFIG.TOKEN_KEY, token); },
    clearAuth() {
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem(CONFIG.USER_KEY);
    },
    setUser(user) { localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(user)); },
    getUser() {
        const userStr = localStorage.getItem(CONFIG.USER_KEY);
        return userStr ? JSON.parse(userStr) : null;
    },
    async request(endpoint, options = {}) {
        const url = `${CONFIG.API_BASE_URL}${endpoint}`;
        const headers = { 'Content-Type': 'application/json', ...options.headers };
        if (options.requireAuth !== false) {
            const token = this.getToken();
            if (token) headers['Authorization'] = `Bearer ${token}`;
        }
        const config = { ...options, headers };
        if (config.body && typeof config.body === 'object') {
            config.body = JSON.stringify(config.body);
        }
        const response = await fetch(url, config);
        const data = await response.json();
        if (response.status === 401) {
            this.clearAuth();
            window.location.reload();
            throw new Error('登录已过期，请重新登录');
        }
        if (!data.success) throw new Error(data.message || '请求失败');
        return data;
    },
    register(username, email, password) {
        return this.request('/auth/register', { method: 'POST', body: { username, email, password }, requireAuth: false });
    },
    async login(username, password) {
        const data = await this.request('/auth/login', { method: 'POST', body: { username, password }, requireAuth: false });
        if (data.data?.access_token) {
            this.setToken(data.data.access_token);
            const userData = await this.getCurrentUser();
            if (userData.data) {
                this.setUser(userData.data);
            }
        }
        return data;
    },
    getCurrentUser() {
        return this.request('/auth/me', { method: 'POST' });
    },
    getRegions() { return this.request('/regions'); },
    getRegionByName(name) {
        return this.request('/regions/', { method: 'GET', body: { name } });
    },
    createRegion(name) {
        return this.request('/regions/create', { method: 'POST', body: { name } });
    },
    getWeatherData(params) {
        const query = new URLSearchParams();
        if (params.region_id) query.append('region_id', params.region_id);
        if (params.start_time) query.append('start_time', params.start_time);
        if (params.end_time) query.append('end_time', params.end_time);
        if (params.limit) query.append('limit', params.limit);
        const endpoint = query.toString() ? `/weather?${query}` : '/weather';
        return this.request(endpoint);
    },
    addWeatherData(data) {
        return this.request('/weather', { method: 'POST', body: data });
    },
    getUsers() { return this.request('/users'); },
    updateUserRole(username, role) { return this.request('/users/role', { method: 'PUT', body: { username, role } }); },
    deleteUser(username) { return this.request(`/users/${username}`, { method: 'DELETE' }); }
};

const uiService = {
    showError(message, id = 'error-message') {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = `<div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">${message}</div>`;
            setTimeout(() => el.innerHTML = '', 5000);
        } else alert(message);
    },
    showSuccess(message, id = 'success-message') {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = `<div class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">${message}</div>`;
            setTimeout(() => el.innerHTML = '', 3000);
        }
    },
    showLoading(containerId) {
        const el = document.getElementById(containerId);
        if (el) el.innerHTML = '<div class="text-center py-8">加载中...</div>';
    },
    updateUserInfo() {
        const user = apiService.getUser();
        const authBtns = document.getElementById('auth-buttons');
        const userInfo = document.getElementById('user-info');
        if (user && authBtns && userInfo) {
            authBtns.classList.add('hidden');
            userInfo.classList.remove('hidden');
            document.getElementById('user-name').textContent = user.username;
            document.getElementById('user-role').textContent = user.role === 'admin' ? '管理员' : '普通用户';
            const adminPanel = document.getElementById('admin-panel');
            if (adminPanel) {
                if (user.role === 'admin') {
                    adminPanel.classList.remove('hidden');
                    appController.loadUsers();
                    appController.loadRegions();
                } else {
                    adminPanel.classList.add('hidden');
                }
            }
        } else if (authBtns && userInfo) {
            authBtns.classList.remove('hidden');
            userInfo.classList.add('hidden');
            const adminPanel = document.getElementById('admin-panel');
            if (adminPanel) adminPanel.classList.add('hidden');
        }
    },
    async renderRegionSelector(selectId, selectedId = null) {
        try {
            const data = await apiService.getRegions();
            const select = document.getElementById(selectId);
            if (!select) return;
            select.innerHTML = '<option value="">请选择区域</option>';
            if (data.data?.length) {
                data.data.forEach(region => {
                    const opt = document.createElement('option');
                    opt.value = region.id;
                    opt.textContent = `${region.name} (${region.code || '无编码'})`;
                    if (selectedId && region.id == selectedId) opt.selected = true;
                    select.appendChild(opt);
                });
            }
        } catch (err) { console.error(err); }
    },
    renderWeatherTable(data, containerId = 'weather-table-container') {
        const container = document.getElementById(containerId);
        if (!container) return;
        if (!data || !data.length) {
            container.innerHTML = '<div class="text-center text-gray-500 p-8">暂无气象数据</div>';
            return;
        }
        let html = `<div class="overflow-x-auto"><table class="min-w-full bg-white border"><thead><tr class="bg-gray-100">
            <th class="px-4 py-2 border">时间</th><th class="px-4 py-2 border">温度(°C)</th><th class="px-4 py-2 border">湿度(%)</th>
            <th class="px-4 py-2 border">风速(m/s)</th><th class="px-4 py-2 border">风向</th><th class="px-4 py-2 border">降水(mm)</th>
           </td></thead><tbody>`;
        data.forEach(item => {
            html += `<tr class="hover:bg-gray-50">
                <td class="px-4 py-2 border">${new Date(item.timestamp).toLocaleString()}</td>
                <td class="px-4 py-2 border">${item.temperature ?? '-'}</td>
                <td class="px-4 py-2 border">${item.humidity ?? '-'}</td>
                <td class="px-4 py-2 border">${item.wind_speed ?? '-'}</td>
                <td class="px-4 py-2 border">${item.wind_direction ?? '-'}</td>
                <td class="px-4 py-2 border">${item.precipitation ?? '-'}</td>
              </tr>`;
        });
        html += `</tbody></table></div>`;
        container.innerHTML = html;
    },
    drawTemperatureChart(canvasId, data) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !data.length) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.clientWidth, height = canvas.clientHeight;
        canvas.width = width; canvas.height = height;
        ctx.clearRect(0, 0, width, height);
        const maxTemp = Math.max(...data, 0);
        const minTemp = Math.min(...data, 0);
        const range = maxTemp - minTemp || 1;
        const stepX = (width - 80) / (data.length - 1);
        ctx.beginPath();
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        for (let i = 0; i < data.length; i++) {
            const x = 40 + i * stepX;
            const y = height - 30 - ((data[i] - minTemp) / range) * (height - 60);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            ctx.fillStyle = '#3b82f6';
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fill();
        }
        ctx.stroke();
        ctx.fillStyle = '#333';
        ctx.font = '12px Arial';
        ctx.fillText('温度变化趋势', width/2 - 60, 20);
    },
    renderUsersList(users) {
        const container = document.getElementById('users-list');
        if (!container) return;
        if (!users?.length) { container.innerHTML = '<div class="text-gray-500 p-4">暂无用户</div>'; return; }
        const currentUser = apiService.getUser();
        let html = `<table class="min-w-full bg-white border"><thead><tr class="bg-gray-100">
            <th class="px-4 py-2 border">ID</th><th class="px-4 py-2 border">用户名</th><th class="px-4 py-2 border">邮箱</th>
            <th class="px-4 py-2 border">角色</th><th class="px-4 py-2 border">操作</th>
           </tr></thead><tbody>`;
        users.forEach(user => {
            const isSelf = currentUser && currentUser.username === user.username;
            html += `<tr>
                <td class="px-4 py-2 border">${user.id}</td>
                <td class="px-4 py-2 border">${user.username}</td>
                <td class="px-4 py-2 border">${user.email || '-'}</td>
                <td class="px-4 py-2 border">
                    <select class="role-select" data-username="${user.username}" ${isSelf ? 'disabled' : ''}>
                        <option value="user" ${user.role === 'user' ? 'selected' : ''}>普通用户</option>
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>管理员</option>
                    </select>
                </td>
                <td class="px-4 py-2 border">
                    ${!isSelf ? `<button class="delete-user bg-red-500 text-white px-2 py-1 rounded text-sm" data-username="${user.username}">删除</button>` : '不可操作自己'}
                </td>
              </tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
        document.querySelectorAll('.role-select').forEach(sel => {
            sel.addEventListener('change', async (e) => {
                const username = sel.dataset.username;
                const newRole = sel.value;
                if (confirm(`确定将用户 "${username}" 角色改为 ${newRole === 'admin' ? '管理员' : '普通用户'} 吗？`)) {
                    try {
                        await apiService.updateUserRole(username, newRole);
                        uiService.showSuccess(`用户 ${username} 角色更新成功`);
                        appController.loadUsers();
                    } catch (err) { uiService.showError(err.message); }
                } else { appController.loadUsers(); }
            });
        });
        document.querySelectorAll('.delete-user').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const username = btn.dataset.username;
                if (confirm(`确定删除用户 "${username}" ？`)) {
                    try {
                        await apiService.deleteUser(username);
                        uiService.showSuccess(`用户 ${username} 已删除`);
                        appController.loadUsers();
                    } catch (err) { uiService.showError(err.message); }
                }
            });
        });
    },
    renderRegionsList(regions) {
        const container = document.getElementById('regions-list');
        if (!container) return;
        if (!regions?.length) { container.innerHTML = '<div class="text-gray-500">暂无区域数据</div>'; return; }
        let html = '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">';
        regions.forEach(region => {
            html += `<div class="bg-gray-50 p-3 rounded shadow-sm flex justify-between items-center">
                        <div><span class="font-medium">${region.name}</span> <span class="text-xs text-gray-500">${region.code || ''}</span></div>
                        <button class="view-region-weather text-blue-600 text-sm" data-id="${region.id}">查看天气</button>
                    </div>`;
        });
        html += '</div>';
        container.innerHTML = html;
        document.querySelectorAll('.view-region-weather').forEach(btn => {
            btn.addEventListener('click', () => {
                const regionId = btn.dataset.id;
                const regionSelect = document.getElementById('region-select');
                if (regionSelect) regionSelect.value = regionId;
                appController.searchWeather();
            });
        });
    },
    showModal(id) {
        const modal = document.getElementById(id);
        if (modal) { modal.style.display = 'flex'; document.body.classList.add('modal-open'); }
    },
    hideModal(id) {
        const modal = document.getElementById(id);
        if (modal) { modal.style.display = 'none'; document.body.classList.remove('modal-open'); }
    },

    // ==================== 高德地图（v1.4.15）相关方法 ====================
    mapInstance: null,
    geocoder: null,
    currentMarker: null,   // 当前地图上的标记

    // 初始化地图（默认中心：成都）
    initMap(lng = 103.988471, lat = 30.581856, name = '默认位置') {
        if (typeof AMap === 'undefined') {
            console.warn('高德地图 API 未加载');
            uiService.showError('高德地图 API 未加载');
            return false;
        }
        const container = document.getElementById('map-container');
        if (!container) return false;

        if (!this.mapInstance) {
            // 首次创建地图
            this.mapInstance = new AMap.Map('map-container', {
                zoom: 10,
                center: [lng, lat],
                viewMode: '3D'
            });
            // 创建地理编码服务
            this.geocoder = new AMap.Geocoder({
                city: '全国',
                radius: 1000
            });
            // 可选：添加点击事件获取坐标
            this.mapInstance.on('click', (e) => {
                const lng = e.lnglat.getLng();
                const lat = e.lnglat.getLat();
                this.updatePositionDisplay(lng, lat);
                uiService.showSuccess(`点击坐标：${lng.toFixed(6)}, ${lat.toFixed(6)}`);
            });
        } else {
            // 已有地图，移动中心并清除旧标记
            this.mapInstance.setCenter([lng, lat]);
            if (this.currentMarker) {
                this.mapInstance.remove(this.currentMarker);
            }
        }
        // 添加新标记
        this.currentMarker = new AMap.Marker({
            position: [lng, lat],
            title: name,
            map: this.mapInstance
        });
        this.updatePositionDisplay(lng, lat);
        return true;
    },

    // 根据区域ID更新地图（区域联动）
    async updateMapByRegionId(regionId) {
        if (!regionId) return;
        try {
            const data = await apiService.getRegions();
            const region = data.data?.find(r => r.id == regionId);
            if (region && region.longitude && region.latitude) {
                this.initMap(region.longitude, region.latitude, region.name);
            } else {
                console.warn('区域无经纬度信息，使用默认地图');
                this.initMap();
            }
        } catch (err) {
            console.error('更新地图失败', err);
            this.initMap(); // 失败时显示默认地图
        }
    },

    // 更新页面上的经纬度显示
    updatePositionDisplay(lng, lat) {
        const posInfo = document.getElementById('position-info');
        const lngSpan = document.getElementById('current-lng');
        const latSpan = document.getElementById('current-lat');
        if (posInfo && lngSpan && latSpan) {
            lngSpan.textContent = lng.toFixed(6);
            latSpan.textContent = lat.toFixed(6);
            posInfo.classList.remove('hidden');
        }
    },

    // 定位当前用户位置
    locateUser() {
        if (!this.mapInstance) {
            uiService.showError('地图尚未初始化');
            return;
        }
        if (!navigator.geolocation) {
            uiService.showError('浏览器不支持地理定位');
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lng = position.coords.longitude;
                const lat = position.coords.latitude;
                this.mapInstance.setCenter([lng, lat]);
                if (this.currentMarker) this.mapInstance.remove(this.currentMarker);
                this.currentMarker = new AMap.Marker({
                    position: [lng, lat],
                    title: '我的位置',
                    map: this.mapInstance
                });
                this.updatePositionDisplay(lng, lat);
                uiService.showSuccess(`已定位到经度 ${lng.toFixed(6)}，纬度 ${lat.toFixed(6)}`);
            },
            (error) => {
                let msg = '定位失败';
                switch (error.code) {
                    case error.PERMISSION_DENIED: msg = '用户拒绝定位权限'; break;
                    case error.POSITION_UNAVAILABLE: msg = '无法获取位置信息'; break;
                    case error.TIMEOUT: msg = '定位超时'; break;
                }
                uiService.showError(msg);
            }
        );
    },

    // 搜索地点并移动地图
    searchPlace(keyword) {
        if (!this.geocoder) {
            uiService.showError('地理编码服务未就绪');
            return;
        }
        if (!keyword.trim()) {
            uiService.showError('请输入搜索关键词');
            return;
        }
        this.geocoder.getLocation(keyword, (status, result) => {
            if (status === 'complete' && result.geocodes && result.geocodes.length > 0) {
                const location = result.geocodes[0].location;
                const lng = location.lng;
                const lat = location.lat;
                const formattedAddress = result.geocodes[0].formattedAddress;
                this.mapInstance.setCenter([lng, lat]);
                if (this.currentMarker) this.mapInstance.remove(this.currentMarker);
                this.currentMarker = new AMap.Marker({
                    position: [lng, lat],
                    title: formattedAddress || keyword,
                    map: this.mapInstance
                });
                this.updatePositionDisplay(lng, lat);
                uiService.showSuccess(`已定位到：${formattedAddress || keyword}`);
            } else {
                uiService.showError(`未找到地点“${keyword}”`);
            }
        });
    }
};

const appController = {
    async init() {
        this.bindEvents();
        uiService.updateUserInfo();
        // 初始化地图（默认成都坐标）
        uiService.initMap(103.988471, 30.581856, '成都');
        if (apiService.getToken()) {
            await this.loadInitialData();
        }
    },
    bindEvents() {
        document.getElementById('login-form')?.addEventListener('submit', e => { e.preventDefault(); this.handleLogin(); });
        document.getElementById('register-form')?.addEventListener('submit', e => { e.preventDefault(); this.handleRegister(); });
        document.getElementById('logout-btn')?.addEventListener('click', () => this.handleLogout());
        document.getElementById('search-weather')?.addEventListener('click', () => this.searchWeather());
        document.getElementById('show-login-modal')?.addEventListener('click', () => uiService.showModal('login-modal'));
        document.getElementById('show-register-modal-btn')?.addEventListener('click', () => uiService.showModal('register-modal'));
        document.getElementById('show-register')?.addEventListener('click', (e) => { e.preventDefault(); uiService.hideModal('login-modal'); uiService.showModal('register-modal'); });
        document.getElementById('goto-login')?.addEventListener('click', (e) => { e.preventDefault(); uiService.hideModal('register-modal'); uiService.showModal('login-modal'); });
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', () => { const id = btn.dataset.modal; if (id) uiService.hideModal(id); });
        });
        document.getElementById('create-region-btn')?.addEventListener('click', () => this.createRegion());
        document.getElementById('refresh-users-btn')?.addEventListener('click', () => this.loadUsers());
        document.getElementById('refresh-regions-btn')?.addEventListener('click', () => this.loadRegions());
        document.getElementById('search-region-by-name')?.addEventListener('click', () => this.searchRegionByName());
        document.getElementById('add-weather-btn')?.addEventListener('click', () => this.addWeatherData());

        // 地图交互事件
        document.getElementById('locate-me')?.addEventListener('click', () => uiService.locateUser());
        document.getElementById('search-position-btn')?.addEventListener('click', () => {
            const keyword = document.getElementById('search-position')?.value;
            if (keyword) uiService.searchPlace(keyword);
        });
        document.getElementById('search-position')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const keyword = e.target.value;
                if (keyword) uiService.searchPlace(keyword);
            }
        });
    },
    async handleLogin() {
        const username = document.getElementById('login-username')?.value;
        const password = document.getElementById('login-password')?.value;
        if (!username || !password) return uiService.showError('请输入用户名和密码');
        try {
            await apiService.login(username, password);
            uiService.showSuccess('登录成功');
            uiService.hideModal('login-modal');
            uiService.updateUserInfo();
            await this.loadInitialData();
            document.getElementById('login-username').value = '';
            document.getElementById('login-password').value = '';
        } catch (err) { uiService.showError(err.message); }
    },
    async handleRegister() {
        const username = document.getElementById('reg-username')?.value;
        const email = document.getElementById('reg-email')?.value;
        const password = document.getElementById('reg-password')?.value;
        const confirm = document.getElementById('reg-confirm-password')?.value;
        if (!username || !email || !password) return uiService.showError('请填写完整');
        if (password !== confirm) return uiService.showError('两次密码不一致');
        if (password.length < 6) return uiService.showError('密码至少6位');
        try {
            await apiService.register(username, email, password);
            uiService.showSuccess('注册成功，请登录');
            uiService.hideModal('register-modal');
            uiService.showModal('login-modal');
        } catch (err) { uiService.showError(err.message); }
    },
    handleLogout() {
        if (confirm('确定退出？')) {
            apiService.clearAuth();
            uiService.updateUserInfo();
            document.getElementById('weather-table-container').innerHTML = '';
            document.getElementById('region-select').innerHTML = '<option value="">请先登录</option>';
        }
    },
    async loadInitialData() {
        try {
            await uiService.renderRegionSelector('region-select');
            await uiService.renderRegionSelector('add-region-id');
            const select = document.getElementById('region-select');
            if (select && select.value) {
                await this.searchWeather();
                await uiService.updateMapByRegionId(select.value);
            }
        } catch (err) { console.error(err); }
    },
    async searchWeather() {
        const regionId = document.getElementById('region-select')?.value;
        if (!regionId) return uiService.showError('请选择区域');
        uiService.showLoading('weather-table-container');
        try {
            const start = document.getElementById('start-time')?.value;
            const end = document.getElementById('end-time')?.value;
            const data = await apiService.getWeatherData({ region_id: regionId, start_time: start, end_time: end });
            if (data.data) {
                uiService.renderWeatherTable(data.data);
                const temps = data.data.map(d => d.temperature).filter(t => t !== null);
                if (temps.length) uiService.drawTemperatureChart('temperature-chart', temps);
                await uiService.updateMapByRegionId(regionId);
            } else uiService.renderWeatherTable([]);
        } catch (err) { uiService.showError(err.message); uiService.renderWeatherTable([]); }
    },
    async searchRegionByName() {
        const name = document.getElementById('search-region-name')?.value.trim();
        if (!name) return uiService.showError('请输入区域名称');
        try {
            const data = await apiService.getRegionByName(name);
            const region = data.data;
            if (region) {
                document.getElementById('region-detail-result').innerHTML = `
                    <div class="bg-blue-50 p-3 rounded">名称: ${region.name}<br>编码: ${region.code}<br>纬度: ${region.latitude}<br>经度: ${region.longitude}</div>
                `;
            } else {
                document.getElementById('region-detail-result').innerHTML = '<div class="text-red-500">未找到该区域</div>';
            }
        } catch (err) { uiService.showError(err.message); }
    },
    async addWeatherData() {
        const region_id = document.getElementById('add-region-id')?.value;
        const timestamp = document.getElementById('add-timestamp')?.value;
        const temperature = document.getElementById('add-temp')?.value;
        const humidity = document.getElementById('add-humidity')?.value;
        const wind_speed = document.getElementById('add-wind-speed')?.value;
        const wind_direction = document.getElementById('add-wind-dir')?.value;
        const precipitation = document.getElementById('add-precip')?.value;
        if (!region_id || !timestamp || !temperature || !humidity || !wind_speed || !wind_direction || !precipitation) {
            return uiService.showError('请完整填写所有字段');
        }
        try {
            await apiService.addWeatherData({
                region_id: parseInt(region_id),
                timestamp,
                temperature: parseFloat(temperature),
                humidity: parseFloat(humidity),
                wind_speed: parseFloat(wind_speed),
                wind_direction,
                precipitation: parseFloat(precipitation)
            });
            uiService.showSuccess('气象数据添加成功');
            document.getElementById('add-timestamp').value = '';
            document.getElementById('add-temp').value = '';
            document.getElementById('add-humidity').value = '';
            document.getElementById('add-wind-speed').value = '';
            document.getElementById('add-wind-dir').value = '';
            document.getElementById('add-precip').value = '';
            const currentRegion = document.getElementById('region-select')?.value;
            if (currentRegion == region_id) await this.searchWeather();
        } catch (err) { uiService.showError(err.message); }
    },
    async loadUsers() {
        try {
            const data = await apiService.getUsers();
            if (data.data) uiService.renderUsersList(data.data);
        } catch (err) { uiService.showError(err.message); }
    },
    async loadRegions() {
        try {
            const data = await apiService.getRegions();
            if (data.data) {
                uiService.renderRegionsList(data.data);
                await uiService.renderRegionSelector('region-select');
                await uiService.renderRegionSelector('add-region-id');
            }
        } catch (err) { uiService.showError(err.message); }
    },
    async createRegion() {
        const name = document.getElementById('new-region-name')?.value.trim();
        if (!name) return uiService.showError('请输入区域名称');
        try {
            await apiService.createRegion(name);
            uiService.showSuccess(`区域 "${name}" 创建成功`);
            document.getElementById('new-region-name').value = '';
            await this.loadRegions();
        } catch (err) { uiService.showError(err.message); }
    }
};

document.addEventListener('DOMContentLoaded', () => appController.init());