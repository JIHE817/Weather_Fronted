const CONFIG = {
    API_BASE_URL: 'http://10.19.244.55:5000/api/v1',
    TOKEN_KEY: 'access_token',
    USER_KEY: 'user_info'
};

// 定义前端请求后端的核心工具对象，封装所有与后端通信的逻辑以及本地存储操作
const apiService = {
     // 获取本地存储中的登录token（凭证）
    getToken() { 
        return localStorage.getItem(CONFIG.TOKEN_KEY); 
    },
    setToken(token) { 
        localStorage.setItem(CONFIG.TOKEN_KEY, token);
     },
    clearAuth() {
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem(CONFIG.USER_KEY);
    },
    setUser(user) { 
        localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(user)); 
    },
    // 从本地存储取出用户信息并转回对象格式
    getUser() {
        const userStr = localStorage.getItem(CONFIG.USER_KEY);
        return userStr ? JSON.parse(userStr) : null;
    },

     //核心功能：封装统一请求方法，所有前端调用后端接口都走这里，它会自动处理认证、错误、数据格式等细节
    async request(endpoint, options = {}) {
        const url = `${CONFIG.API_BASE_URL}${endpoint}`;
        const headers = { 'Content-Type': 'application/json', ...options.headers };
        if (options.requireAuth !== false) {// 判断是否需要登录权限，默认需要，如果 requireAuth 显式设置为 false 则不添加认证信息
            const token = this.getToken();
            if (token) headers['Authorization'] = `Bearer ${token}`;
        }

        // 合并请求配置，并自动将 body 对象转换为 JSON 字符串
        const config = { ...options, headers };
        if (config.body && typeof config.body === 'object') {
            config.body = JSON.stringify(config.body);
        }
        const response = await fetch(url, config);
        // 将后端返回的数据转成JSON格式 
        const data = await response.json();

         // 如果后端返回401（登录过期），清除登录状态并刷新页面让用户重新登录
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
        const body = {};
        if (params.region_id) body.region_id = params.region_id;
        if (params.start_time) body.start_time = params.start_time;
        if (params.end_time) body.end_time = params.end_time;
        if (params.limit) body.limit = params.limit;
        if (params.data_type) body.data_type = params.data_type;
        return this.request('/weather', { method: 'POST', body });
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
            // 保存当前选中的值
            const currentValue = select.value;
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
            // 恢复之前选中的值
            if (currentValue && !selectedId) {
                select.value = currentValue;
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
    
    let html = `
        <div class="overflow-x-auto shadow-md rounded-lg">
            <table class="min-w-full bg-white border border-gray-200">
                <thead class="bg-gray-100">
                    <tr>
                        <th class="px-4 py-3 border-b border-gray-200 text-left text-sm font-semibold text-gray-700">时间</th>
                        <th class="px-4 py-3 border-b border-gray-200 text-left text-sm font-semibold text-gray-700">温度(°C)</th>
                        <th class="px-4 py-3 border-b border-gray-200 text-left text-sm font-semibold text-gray-700">湿度(%)</th>
                        <th class="px-4 py-3 border-b border-gray-200 text-left text-sm font-semibold text-gray-700">风速(m/s)</th>
                        <th class="px-4 py-3 border-b border-gray-200 text-left text-sm font-semibold text-gray-700">风向</th>
                        <th class="px-4 py-3 border-b border-gray-200 text-left text-sm font-semibold text-gray-700">降水(mm)</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    data.forEach(item => {
        const timestamp = item.timestamp ? new Date(item.timestamp).toLocaleString() : '-';
        const temperature = item.temperature !== undefined && item.temperature !== null ? item.temperature : '-';
        const humidity = item.humidity !== undefined && item.humidity !== null ? item.humidity : '-';
        const windSpeed = item.wind_speed !== undefined && item.wind_speed !== null ? item.wind_speed : '-';
        const windDirection = item.wind_direction || '-';
        const precipitation = item.precipitation !== undefined && item.precipitation !== null ? item.precipitation : '-';
        
        html += `
            <tr class="hover:bg-gray-50 border-b border-gray-200">
                <td class="px-4 py-2 text-sm text-gray-700 whitespace-nowrap">${timestamp}</td>
                <td class="px-4 py-2 text-sm text-gray-700">${temperature}</td>
                <td class="px-4 py-2 text-sm text-gray-700">${humidity}</td>
                <td class="px-4 py-2 text-sm text-gray-700">${windSpeed}</td>
                <td class="px-4 py-2 text-sm text-gray-700">${windDirection}</td>
                <td class="px-4 py-2 text-sm text-gray-700">${precipitation}</td>
            </tr>
        `;
    });
    
    html += `
                </tbody>
            </table>
        </div>
    `;
    
    container.innerHTML = html;
},
    drawTemperatureChart(canvasId, data) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !data || data.length === 0) {
            console.warn('无温度数据或画布不存在');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                const width = canvas.clientWidth, height = canvas.clientHeight;
                canvas.width = width; canvas.height = height;
                ctx.clearRect(0, 0, width, height);
                ctx.fillStyle = '#999';
                ctx.font = '14px Arial';
                ctx.fillText('暂无温度数据', width/2 - 50, height/2);
            }
            return;
        }

        const ctx = canvas.getContext('2d');
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        
        canvas.width = width;
        canvas.height = height;
        ctx.clearRect(0, 0, width, height);
        
        const validData = data.filter(t => t !== null && t !== undefined);
        if (validData.length === 0) {
            ctx.fillStyle = '#999';
            ctx.font = '14px Arial';
            ctx.fillText('无有效温度数据', width/2 - 50, height/2);
            return;
        }
        
        const maxTemp = Math.max(...validData);
        const minTemp = Math.min(...validData);
        const range = maxTemp - minTemp;
        const actualRange = range === 0 ? 10 : range;
        const padding = actualRange * 0.1;
        
        const yMin = minTemp - padding;
        const yMax = maxTemp + padding;
        const yRange = yMax - yMin;
        
        const margin = { top: 40, right: 30, bottom: 40, left: 50 };
        const chartWidth = width - margin.left - margin.right;
        const chartHeight = height - margin.top - margin.bottom;
        const stepX = chartWidth / (validData.length - 1);
        
        ctx.save();
        
        // 绘制坐标轴
        ctx.beginPath();
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        ctx.moveTo(margin.left, height - margin.bottom);
        ctx.lineTo(width - margin.right, height - margin.bottom);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(margin.left, margin.top);
        ctx.lineTo(margin.left, height - margin.bottom);
        ctx.stroke();
        
        // Y轴刻度
        ctx.fillStyle = '#666';
        ctx.font = '11px Arial';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        
        const yTickCount = 5;
        for (let i = 0; i <= yTickCount; i++) {
            const yValue = yMin + (i / yTickCount) * yRange;
            const y = height - margin.bottom - (i / yTickCount) * chartHeight;
            
            ctx.beginPath();
            ctx.strokeStyle = '#e0e0e0';
            ctx.moveTo(margin.left - 5, y);
            ctx.lineTo(margin.left, y);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.strokeStyle = '#f0f0f0';
            ctx.moveTo(margin.left, y);
            ctx.lineTo(width - margin.right, y);
            ctx.stroke();
            
            ctx.fillStyle = '#666';
            ctx.fillText(yValue.toFixed(1) + '°C', margin.left - 8, y);
        }
        
        // X轴标签
        ctx.fillStyle = '#666';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        
        const xLabelCount = Math.min(5, validData.length);
        for (let i = 0; i < xLabelCount; i++) {
            const dataIndex = Math.floor((i / (xLabelCount - 1)) * (validData.length - 1));
            const x = margin.left + dataIndex * stepX;
            ctx.fillText(`点${dataIndex + 1}`, x, height - margin.bottom + 5);
        }
        
        // 绘制折线
        ctx.beginPath();
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        let firstPoint = true;
        const points = [];
        
        for (let i = 0; i < validData.length; i++) {
            const x = margin.left + i * stepX;
            const y = height - margin.bottom - ((validData[i] - yMin) / yRange) * chartHeight;
            points.push({ x, y, temp: validData[i] });
            if (firstPoint) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        
        // 绘制数据点
        for (let i = 0; i < points.length; i++) {
            ctx.beginPath();
            ctx.fillStyle = '#3b82f6';
            ctx.arc(points[i].x, points[i].y, 4, 0, 2 * Math.PI);
            ctx.fill();
            
            ctx.beginPath();
            ctx.fillStyle = '#fff';
            ctx.arc(points[i].x, points[i].y, 2, 0, 2 * Math.PI);
            ctx.fill();
            
            ctx.fillStyle = '#1f2937';
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(points[i].temp.toFixed(1) + '°C', points[i].x, points[i].y - 6);
        }
        
        ctx.fillStyle = '#374151';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('温度变化趋势图', width / 2, margin.top - 15);
        
        ctx.fillStyle = '#6b7280';
        ctx.font = '11px Arial';
        ctx.fillText('时间序列', width / 2, height - 10);
        
        ctx.save();
        ctx.translate(18, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#6b7280';
        ctx.font = '11px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('温度 (°C)', 0, 0);
        ctx.restore();
        
        ctx.restore();
    },
    
    // 新增 drawLineChart 方法（用于数据类型趋势图）
    drawLineChart(canvasId, data, label, unit) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !data || data.length === 0) {
            if (canvas) {
                const ctx = canvas.getContext('2d');
                const width = canvas.clientWidth, height = canvas.clientHeight;
                canvas.width = width; canvas.height = height;
                ctx.clearRect(0, 0, width, height);
                ctx.fillStyle = '#999';
                ctx.font = '14px Arial';
                ctx.fillText('暂无数据', width/2 - 40, height/2);
            }
            return;
        }

        const ctx = canvas.getContext('2d');
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        
        canvas.width = width;
        canvas.height = height;
        ctx.clearRect(0, 0, width, height);
        
        const values = data.map(item => item.value !== undefined ? item.value : item);
        if (values.length === 0) return;
        
        const maxVal = Math.max(...values, 0);
        const minVal = Math.min(...values, 0);
        const range = maxVal - minVal;
        const actualRange = range === 0 ? 10 : range;
        const padding = actualRange * 0.1;
        
        const yMin = minVal - padding;
        const yMax = maxVal + padding;
        const yRange = yMax - yMin;
        
        const margin = { top: 40, right: 30, bottom: 40, left: 50 };
        const chartWidth = width - margin.left - margin.right;
        const chartHeight = height - margin.top - margin.bottom;
        const stepX = chartWidth / (values.length - 1);
        
        ctx.save();
        
        ctx.beginPath();
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        ctx.moveTo(margin.left, height - margin.bottom);
        ctx.lineTo(width - margin.right, height - margin.bottom);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(margin.left, margin.top);
        ctx.lineTo(margin.left, height - margin.bottom);
        ctx.stroke();
        
        ctx.fillStyle = '#666';
        ctx.font = '11px Arial';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        
        const yTickCount = 5;
        for (let i = 0; i <= yTickCount; i++) {
            const yValue = yMin + (i / yTickCount) * yRange;
            const y = height - margin.bottom - (i / yTickCount) * chartHeight;
            
            ctx.beginPath();
            ctx.strokeStyle = '#e0e0e0';
            ctx.moveTo(margin.left - 5, y);
            ctx.lineTo(margin.left, y);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.strokeStyle = '#f0f0f0';
            ctx.moveTo(margin.left, y);
            ctx.lineTo(width - margin.right, y);
            ctx.stroke();
            
            ctx.fillStyle = '#666';
            ctx.fillText(yValue.toFixed(1), margin.left - 8, y);
        }
        
        ctx.fillStyle = '#666';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        
        const xLabelCount = Math.min(5, values.length);
        for (let i = 0; i < xLabelCount; i++) {
            const dataIndex = Math.floor((i / (xLabelCount - 1)) * (values.length - 1));
            const x = margin.left + dataIndex * stepX;
            ctx.fillText(`点${dataIndex + 1}`, x, height - margin.bottom + 5);
        }
        
        ctx.beginPath();
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        let firstPoint = true;
        const points = [];
        
        for (let i = 0; i < values.length; i++) {
            const x = margin.left + i * stepX;
            const y = height - margin.bottom - ((values[i] - yMin) / yRange) * chartHeight;
            points.push({ x, y, val: values[i] });
            if (firstPoint) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        
        for (let i = 0; i < points.length; i++) {
            ctx.beginPath();
            ctx.fillStyle = '#f97316';
            ctx.arc(points[i].x, points[i].y, 4, 0, 2 * Math.PI);
            ctx.fill();
            
            ctx.beginPath();
            ctx.fillStyle = '#fff';
            ctx.arc(points[i].x, points[i].y, 2, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        ctx.fillStyle = '#374151';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${label}趋势图`, width / 2, margin.top - 15);
        
        ctx.fillStyle = '#6b7280';
        ctx.font = '11px Arial';
        ctx.fillText('时间序列', width / 2, height - 10);
        
        ctx.save();
        ctx.translate(18, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#6b7280';
        ctx.font = '11px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${label} (${unit})`, 0, 0);
        ctx.restore();
        
        ctx.restore();
    },
    
    renderUsersList(users) {
        const container = document.getElementById('users-list');
        if (!container) return;
        if (!users?.length) { container.innerHTML = '<div class="text-gray-500 p-4">暂无用户</div>'; return; }
        const currentUser = apiService.getUser();
        let html = `<table class="min-w-full bg-white border"><thead><tr class="bg-gray-100">
            <th class="px-4 py-2 border">ID</th><th class="px-4 py-2 border">用户名</th><th class="px-4 py-2 border">邮箱</th>
            <th class="px-4 py-2 border">角色</th><th class="px-4 py-2 border">操作</th>
            <tr></thead><tbody>`;
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

    // ==================== 高德地图相关方法 ====================
    mapInstance: null,
    geocoder: null,
    currentMarker: null,

    destroyMap() {
        if (this.mapInstance) {
            try {
                this.mapInstance.destroy();
            } catch(e) {}
            this.mapInstance = null;
        }
        this.geocoder = null;
        this.currentMarker = null;
    },

    initMap(lng = 103.988471, lat = 30.581856, name = '默认位置') {
        if (typeof AMap === 'undefined') {
            console.warn('高德地图 API 未加载');
            uiService.showError('高德地图 API 未加载');
            return false;
        }
        const container = document.getElementById('map-container');
        if (!container) return false;

        if (this.mapInstance) {
            this.destroyMap();
        }

        this.mapInstance = new AMap.Map('map-container', {
            zoom: 10,
            center: [lng, lat],
            viewMode: '3D'
        });
        
        // 异步加载 Geocoder
        AMap.plugin(['AMap.Geocoder'], () => {
            this.geocoder = new AMap.Geocoder({
                city: '全国',
                radius: 1000
            });
        });
        
        this.mapInstance.on('click', (e) => {
            const lng = e.lnglat.getLng();
            const lat = e.lnglat.getLat();
            this.updatePositionDisplay(lng, lat);
            uiService.showSuccess(`点击坐标：${lng.toFixed(6)}, ${lat.toFixed(6)}`);
        });

        this.currentMarker = new AMap.Marker({
            position: [lng, lat],
            title: name,
            map: this.mapInstance
        });
        this.updatePositionDisplay(lng, lat);
        return true;
    },

    async updateMapByRegionId(regionId) {
        if (!regionId) return;
        try {
            const data = await apiService.getRegions();
            const region = data.data?.find(r => r.id == regionId);
            if (region && region.longitude && region.latitude) {
                this.initMap(region.longitude, region.latitude, region.name);
            } else {
                this.initMap();
            }
        } catch (err) {
            console.error('更新地图失败', err);
            this.initMap();
        }
    },

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

    searchPlace(keyword) {
        if (!this.geocoder) {
            // 尝试重新加载
            AMap.plugin(['AMap.Geocoder'], () => {
                this.geocoder = new AMap.Geocoder({
                    city: '全国',
                    radius: 1000
                });
                this.doSearchPlace(keyword);
            });
            return;
        }
        this.doSearchPlace(keyword);
    },
    
    doSearchPlace(keyword) {
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
    },

    // ==================== 视图切换方法 ====================
    showWelcome() {
        const welcomeContainer = document.getElementById('welcome-container');
        const mainContainer = document.getElementById('main-app-container');
        if (welcomeContainer) welcomeContainer.classList.remove('hidden');
        if (mainContainer) mainContainer.classList.add('hidden');
        this.destroyMap();
    },

    showMainApp() {
        const welcomeContainer = document.getElementById('welcome-container');
        const mainContainer = document.getElementById('main-app-container');
        if (welcomeContainer) welcomeContainer.classList.add('hidden');
        if (mainContainer) mainContainer.classList.remove('hidden');
    },

    clearAppData() {
        const weatherContainer = document.getElementById('weather-table-container');
        if (weatherContainer) weatherContainer.innerHTML = '<div class="text-center text-gray-400 py-8">请选择区域并点击查询</div>';
        const canvas = document.getElementById('temperature-chart');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        const dataTypeCanvas = document.getElementById('data-type-chart');
        if (dataTypeCanvas) {
            const ctx = dataTypeCanvas.getContext('2d');
            ctx.clearRect(0, 0, dataTypeCanvas.width, dataTypeCanvas.height);
        }
        const regionSelect = document.getElementById('region-select');
        if (regionSelect) regionSelect.innerHTML = '<option value="">请先登录</option>';
        const addRegionSelect = document.getElementById('add-region-id');
        if (addRegionSelect) addRegionSelect.innerHTML = '<option value="">选择区域</option>';
        this.destroyMap();
    }
};

const appController = {
    isSearching: false,  // 防止重复查询
    
    async init() {
        this.bindEvents();
        
        const token = apiService.getToken();
        const user = apiService.getUser();
        
        if (token && user) {
            uiService.showMainApp();
            uiService.updateUserInfo();
            await this.loadInitialData();
            await this.initMainApp();
        } else {
            uiService.showWelcome();
            uiService.updateUserInfo();
            uiService.clearAppData();
        }
    },
    
    async initMainApp() {
        uiService.initMap(103.988471, 30.581856, '成都');
        await uiService.renderRegionSelector('region-select');
        await uiService.renderRegionSelector('add-region-id');
        const select = document.getElementById('region-select');
        if (select && select.value) {
            await this.searchWeather();
            await uiService.updateMapByRegionId(select.value);
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
        document.getElementById('load-trend-btn')?.addEventListener('click', () => this.loadDataTypeTrend());

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
        
        document.getElementById('welcome-login-btn')?.addEventListener('click', () => uiService.showModal('login-modal'));
        document.getElementById('welcome-register-btn')?.addEventListener('click', () => uiService.showModal('register-modal'));
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
            uiService.showMainApp();
            await this.initMainApp();
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
            uiService.clearAppData();
            uiService.showWelcome();
        }
    },
    
    async loadInitialData() {
        try {
            await uiService.renderRegionSelector('region-select');
            await uiService.renderRegionSelector('add-region-id');
            const select = document.getElementById('region-select');
            if (select && select.value) {
                await this.searchWeather();
            }
        } catch (err) { console.error(err); }
    },
    
    async searchWeather() {
        // 防止重复查询
        if (this.isSearching) return;
        this.isSearching = true;
        
        const regionId = document.getElementById('region-select')?.value;
        if (!regionId) {
            this.isSearching = false;
            return uiService.showError('请选择区域');
        }
        
        const start = document.getElementById('start-time')?.value;
        const end = document.getElementById('end-time')?.value;
        
        uiService.showLoading('weather-table-container');
        try {
            const data = await apiService.getWeatherData({ 
                region_id: regionId, 
                start_time: start, 
                end_time: end 
            });
            
            if (data.data && data.data.length) {
                // 直接渲染表格
                uiService.renderWeatherTable(data.data);
                // 绘制温度趋势图
                const temps = data.data.map(d => d.temperature).filter(t => t !== null && t !== undefined);
                if (temps.length) {
                    uiService.drawTemperatureChart('temperature-chart', temps);
                }
                // 更新地图
                await uiService.updateMapByRegionId(regionId);
            } else {
                uiService.renderWeatherTable([]);
                uiService.drawTemperatureChart('temperature-chart', []);
            }
        } catch (err) {
            console.error('查询气象数据失败:', err);
            uiService.showError(err.message);
            uiService.renderWeatherTable([]);
        } finally {
            this.isSearching = false;
        }
    },
    
    async loadDataTypeTrend() {
        const regionId = document.getElementById('region-select')?.value;
        if (!regionId) return uiService.showError('请先选择区域');

        const dataType = document.getElementById('data-type-select')?.value;
        if (!dataType) return uiService.showError('请选择数据类型');

        const start = document.getElementById('start-time')?.value;
        const end = document.getElementById('end-time')?.value;

        try {
            const result = await apiService.getWeatherData({
                region_id: regionId,
                start_time: start,
                end_time: end,
                data_type: dataType
            });

            if (result.data && result.data.length) {
                const mappedData = result.data.map(item => ({
                    timestamp: item.timestamp,
                    value: item[dataType]
                }));
                const labelMap = {
                    temperature: '温度',
                    humidity: '湿度',
                    wind_speed: '风速',
                    precipitation: '降水量'
                };
                const unitMap = {
                    temperature: '°C',
                    humidity: '%',
                    wind_speed: 'm/s',
                    precipitation: 'mm'
                };
                uiService.drawLineChart(
                    'data-type-chart',
                    mappedData,
                    labelMap[dataType] || dataType,
                    unitMap[dataType] || ''
                );
                uiService.showSuccess(`${labelMap[dataType]}趋势图加载完成`);
            } else {
                uiService.drawLineChart('data-type-chart', []);
                uiService.showError('所选时间段内无数据');
            }
        } catch (err) {
            uiService.showError(err.message);
            uiService.drawLineChart('data-type-chart', []);
        }
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
        } catch (err) { 
            uiService.showError(err.message); 
        }
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

// 仅在主页（包含 map-container 元素）时才执行主页初始化
if (document.getElementById('map-container')) {
    document.addEventListener('DOMContentLoaded', () => appController.init());
}