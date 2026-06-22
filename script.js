const CONFIG = {
    API_BASE_URL: 'http://10.19.244.55:5000/api/v1',
    TOKEN_KEY: 'access_token',
    USER_KEY: 'user_info'
};
//管理员：80-82，172-191，225行判断是否是管理员
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
        const headers = { ...options.headers };

        // 只有携带请求体时才设置 JSON Content-Type，避免无谓触发 CORS 预检
        const hasBody = options.body && typeof options.body === 'object';
        if (hasBody) {
            headers['Content-Type'] = 'application/json';
        }

        if (options.requireAuth !== false) {
            const token = this.getToken();
            if (token) headers['Authorization'] = `Bearer ${token}`;
        }

        // 构建 fetch 配置，剔除自定义字段 requireAuth
        const { requireAuth, ...fetchOptions } = options;
        const config = { ...fetchOptions, headers };
        if (hasBody) {
            config.body = JSON.stringify(options.body);
        }

        let response;
        try {
            response = await fetch(url, config);
        } catch (err) {
            throw new Error(`无法连接服务器 (${CONFIG.API_BASE_URL})，请检查后端服务是否启动`);
        }

        // 先用 text 读取原始响应，再用 JSON 解析
        let rawText;
        try {
            rawText = await response.text();
        } catch (err) {
            console.error('读取响应体失败，原始错误:', err.message);
            throw new Error(
                `后端在发送响应体之前断开了连接 (HTTP ${response.status})。\n` +
                `这通常是因为后端 /weather 接口内部报错崩溃导致连接重置。\n` +
                `请检查后端日志中 /weather 接口的异常信息。`
            );
        }

        let data;
        try {
            data = JSON.parse(rawText);
        } catch (err) {
            const preview = rawText.length > 300 ? rawText.substring(0, 300) + '...' : rawText;
            console.error('后端返回非 JSON 响应:', preview);
            throw new Error(`服务器返回了非 JSON 数据 (HTTP ${response.status})，请检查后端日志。响应预览: ${preview}`);
        }

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
        // 清除旧数据，避免残留干扰
        this.clearAuth();

        const data = await this.request('/auth/login', {
            method: 'POST',
            body: { username, password },
            requireAuth: false
        });

        console.log('/auth/login 响应:', data.data);

        if (data.data?.access_token) {
            this.setToken(data.data.access_token);

            // 优先从登录响应中提取用户信息
            let userFromLogin = null;
            if (data.data.user && typeof data.data.user === 'object') {
                userFromLogin = data.data.user;
                console.log('从登录响应 data.user 提取:', userFromLogin);
            } else if (data.data.username) {
                userFromLogin = {
                    username: data.data.username,
                    email: data.data.email || '',
                    role: data.data.role || data.data.role_name || null
                };
                console.log('从登录响应 data 平铺字段提取:', userFromLogin);
            }

            // 再从 /auth/me 获取完整用户信息
            let userFromMe = null;
            try {
                const userData = await this.getCurrentUser();
                console.log('/auth/me 响应:', userData.data);
                if (userData.data) {
                    userFromMe = userData.data;
                }
            } catch (err) {
                console.warn('/auth/me 请求失败:', err.message);
            }

            // 合并：/auth/me 优先，登录响应补充缺失字段
            const mergedUser = { ...(userFromLogin || {}), ...(userFromMe || {}) };
            console.log('合并后用户信息:', mergedUser);

            // 如果两个来源都没有 role 字段，通过调用 /users 探测管理员身份
            if (!mergedUser.role) {
                console.log('未获取到 role，通过 /users 接口探测管理员身份...');
                try {
                    await this.request('/users');
                    mergedUser.role = 'admin';
                    console.log('/users 调用成功，判定为管理员');
                } catch (err) {
                    mergedUser.role = 'user';
                    console.log('/users 调用失败，判定为普通用户');
                }
            }

            if (mergedUser.username) {
                this.setUser(mergedUser);
            } else if (userFromLogin) {
                this.setUser(userFromLogin);
            } else {
                throw new Error('登录成功但无法获取用户信息');
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
    return this.request('/weather/addition', { method: 'POST', body: data });
},
//管理员
// 导出气象数据（返回文件流）
    async exportWeatherData(region_id, start_time = '', end_time = '') {
        const url = `${CONFIG.API_BASE_URL}/weather/export`;
        const token = this.getToken();
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
        const body = JSON.stringify({ region_id, start_time, end_time });

        const response = await fetch(url, { method: 'POST', headers, body });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `导出失败 (HTTP ${response.status})`);
        }
        // 获取文件流并下载
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `weather_export_${region_id}_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);
},

    getUsers() { return this.request('/users'); },
    updateUserRole(username, role) { return this.request('/users/role', { method: 'PUT', body: { username, role } }); },
    deleteUser(username) { return this.request(`/users/${username}`, { method: 'DELETE' }); },

// 获取区域边界 GeoJSON（返回 JSON 对象）
async getRegionBoundary(region_id) {
    const url = `${CONFIG.API_BASE_URL}/weather/boundary?region_id=${region_id}`;
    const token = this.getToken();
    const response = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `获取边界失败 (HTTP ${response.status})`);
    }
    return await response.json();
},

// 导出区域边界 GeoJSON 文件（下载）
async exportRegionBoundary(region_id) {
    const url = `${CONFIG.API_BASE_URL}/weather/boundary/export?region_id=${region_id}`;
    const token = this.getToken();
    const response = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `导出边界失败 (HTTP ${response.status})`);
    }
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    // 从 Content-Disposition 获取文件名，或使用默认名
    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = `region_${region_id}.geojson`;
    if (contentDisposition) {
        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match && match[1]) filename = match[1].replace(/['"]/g, '');
    }
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);
},

// 上传栅格数据（管理员）
async uploadRaster(file, data_type, region_id, name = '', resolution = null) {
    const url = `${CONFIG.API_BASE_URL}/upload/raster`;
    const token = this.getToken();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('data_type', data_type);
    formData.append('region_id', region_id);
    if (name) formData.append('name', name);
    if (resolution) formData.append('resolution', resolution);
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.message || '上传失败');
    return data;
},

// ==================== 栅格数据接口 ====================
// 查询栅格数据
async getRasterData(region_id, data_type, resolution = null, bbox = null) {
    const params = new URLSearchParams();
    params.append('region_id', region_id);
    params.append('data_type', data_type);
    if (resolution) params.append('resolution', resolution);
    if (bbox) params.append('bbox', bbox);
    
    const url = `/raster/data?${params.toString()}`;
    return this.request(url, { method: 'GET' });
},

// ==================== 预警与空间分析接口 ====================
// 获取当前区域预警
async getCurrentAlert(region_id) {
    return this.request(`/alerts/current?region_id=${region_id}`, { method: 'GET' });
},

// 计算干旱指数
async getDroughtIndex(region_id) {
    return this.request(`/indices/drought?region_id=${region_id}`, { method: 'GET' });
},

// 地形统计分析
async getTerrainAnalysis(region_id) {
    return this.request(`/analysis/terrain?region_id=${region_id}`, { method: 'GET' });
}
    
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
            const isAdmin = user.role && String(user.role).toLowerCase() === 'admin';
            document.getElementById('user-role').textContent = isAdmin ? '管理员' : '普通用户';
            const adminPanel = document.getElementById('admin-panel');
            const adminConsoleBtn = document.getElementById('admin-console-btn');
            if (adminPanel) {
                if (isAdmin) {
                    adminPanel.classList.remove('hidden');
                    if (adminConsoleBtn) adminConsoleBtn.classList.remove('hidden');
                    appController.loadUsers();
                    appController.loadRegions();
                    appController.loadRasterRegionSelect();
                } else {
                    adminPanel.classList.add('hidden');
                    if (adminConsoleBtn) adminConsoleBtn.classList.add('hidden');
                }
            }
        } else if (authBtns && userInfo) {
            authBtns.classList.remove('hidden');
            userInfo.classList.add('hidden');
            const adminPanel = document.getElementById('admin-panel');
            if (adminPanel) adminPanel.classList.add('hidden');
            const adminConsoleBtn = document.getElementById('admin-console-btn');
            if (adminConsoleBtn) adminConsoleBtn.classList.add('hidden');
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
            // 确保经纬度是数字类型
            const lng = parseFloat(region.longitude);
            const lat = parseFloat(region.latitude);
            if (!isNaN(lng) && !isNaN(lat)) {
                this.initMap(lng, lat, region.name);
            } else {
                this.initMap();
            }
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
        // 确保是数字类型
        const lngNum = parseFloat(lng);
        const latNum = parseFloat(lat);
        lngSpan.textContent = isNaN(lngNum) ? lng : lngNum.toFixed(6);
        latSpan.textContent = isNaN(latNum) ? lat : latNum.toFixed(6);
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
        this.stopClock();
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
    },

    // ==================== 实时时钟与迷你日历 ====================
    _clockTimer: null,

    startClock() {
        const tick = () => {
            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const ss = String(now.getSeconds()).padStart(2, '0');
            const clockEl = document.getElementById('realtime-clock');
            if (clockEl) clockEl.textContent = `${hh}:${mm}:${ss}`;

            const dateEl = document.getElementById('realtime-date');
            if (dateEl) {
                dateEl.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
            }
        };
        tick();
        this._clockTimer = setInterval(tick, 1000);
    },

    stopClock() {
        if (this._clockTimer) {
            clearInterval(this._clockTimer);
            this._clockTimer = null;
        }
    },

    initCalendar() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const today = now.getDate();

        const titleEl = document.getElementById('cal-month-year');
        if (titleEl) titleEl.textContent = `${year}年${month}月`;

        const daysEl = document.getElementById('cal-days');
        if (!daysEl) return;

        const firstDay = new Date(year, month - 1, 1);
        const lastDay = new Date(year, month, 0);
        const startDow = firstDay.getDay();
        const daysInMonth = lastDay.getDate();

        let html = '';
        for (let i = 0; i < startDow; i++) {
            html += '<span class="text-gray-300">·</span>';
        }
        for (let d = 1; d <= daysInMonth; d++) {
            html += (d === today)
                ? `<span class="rounded-full bg-blue-600 text-white font-bold leading-relaxed">${d}</span>`
                : `<span class="text-gray-600">${d}</span>`;
        }
        daysEl.innerHTML = html;
    },

    // ==================== Toast 弹窗通知 ====================
    showToast(message, type = 'success') {
        const overlay = document.getElementById('toast-overlay');
        const box = document.getElementById('toast-box');
        const icon = document.getElementById('toast-icon');
        const msg = document.getElementById('toast-message');
        if (!overlay || !box || !icon || !msg) {
            if (type === 'success') this.showSuccess(message);
            else this.showError(message);
            return;
        }

        msg.textContent = message;
        if (type === 'success') {
            icon.textContent = '✅';
            icon.className = 'text-5xl mb-3';
        } else {
            icon.textContent = '❌';
            icon.className = 'text-5xl mb-3';
        }

        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
        setTimeout(() => box.classList.remove('scale-95'), 10);

        const closeBtn = document.getElementById('toast-close');
        const close = () => {
            box.classList.add('scale-95');
            setTimeout(() => {
                overlay.classList.add('hidden');
                overlay.classList.remove('flex');
            }, 200);
        };
        closeBtn.onclick = close;

        if (type === 'success') {
            setTimeout(close, 3000);
        }
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
        uiService.startClock();
        uiService.initCalendar();
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
        
        // 导出区域边界按钮事件
        document.getElementById('export-boundary-btn')?.addEventListener('click', async () => {
            const regionId = document.getElementById('region-select')?.value;
            if (!regionId) {
                uiService.showError('请先选择一个区域');
                return;
            }
            try {
                await apiService.exportRegionBoundary(regionId);
                uiService.showSuccess('区域边界导出成功');
            } catch (err) {
                uiService.showError(err.message);
            }
        });
        
        // 上传栅格数据按钮事件
        document.getElementById('upload-raster-btn')?.addEventListener('click', async () => {
            const fileInput = document.getElementById('raster-file');
            const file = fileInput.files[0];
            if (!file) {
                uiService.showError('请选择文件');
                return;
            }
            const dataType = document.getElementById('raster-data-type')?.value;
            const regionId = document.getElementById('raster-region-id')?.value;
            if (!regionId) {
                uiService.showError('请选择关联区域');
                return;
            }
            const name = document.getElementById('raster-name')?.value.trim();
            const resolution = document.getElementById('raster-resolution')?.value;
            try {
                await apiService.uploadRaster(file, dataType, parseInt(regionId), name, resolution ? parseFloat(resolution) : null);
                uiService.showToast('栅格数据上传成功', 'success');
                fileInput.value = '';
                if (document.getElementById('raster-name')) document.getElementById('raster-name').value = '';
                if (document.getElementById('raster-resolution')) document.getElementById('raster-resolution').value = '';
            } catch (err) {
                uiService.showToast(err.message, 'error');
            }
        });

        document.getElementById('welcome-login-btn')?.addEventListener('click', () => uiService.showModal('login-modal'));
        document.getElementById('welcome-register-btn')?.addEventListener('click', () => uiService.showModal('register-modal'));

        // ===== 管理员标签页切换 =====
        document.querySelectorAll('.admin-tab-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.admin-tab-btn').forEach(b => {
                    b.classList.remove('active', 'text-blue-600', 'border-blue-600', 'bg-blue-50');
                    b.classList.add('text-gray-600', 'border-transparent');
                });
                this.classList.add('active', 'text-blue-600', 'border-blue-600', 'bg-blue-50');
                this.classList.remove('text-gray-600', 'border-transparent');

                document.querySelectorAll('.admin-tab-content').forEach(content => {
                    content.classList.add('hidden');
                });

                const tabId = this.dataset.tab;
                const targetContent = document.getElementById(`admin-tab-${tabId}`);
                if (targetContent) {
                    targetContent.classList.remove('hidden');
                }
            });
        });

        // ===== 右侧功能菜单：管理员控制台按钮（滚动到管理员面板） =====
        document.getElementById('admin-console-btn')?.addEventListener('click', () => {
            const adminPanel = document.getElementById('admin-panel');
            if (adminPanel) {
                adminPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });

        // =============================================================
        // ===== 新增：栅格数据查询 =====
        // =============================================================
        document.getElementById('query-raster-btn')?.addEventListener('click', async () => {
            const regionId = document.getElementById('region-select')?.value;
            if (!regionId) {
                uiService.showToast('请先选择区域', 'error');
                return;
            }
            const dataType = document.getElementById('raster-data-type-query')?.value;
            const resolution = document.getElementById('raster-resolution-query')?.value;
            
            try {
                const result = await apiService.getRasterData(
                    parseInt(regionId), 
                    dataType, 
                    resolution ? parseInt(resolution) : null
                );
                
                const display = document.getElementById('raster-data-display');
                const container = document.getElementById('raster-result');
                if (result.data) {
                    const data = result.data;
                    let info = `数据类型: ${data.data_type || dataType}\n`;
                    info += `单位: ${data.units || '无'}\n`;
                    if (data.min !== undefined) info += `最小值: ${data.min}\n`;
                    if (data.max !== undefined) info += `最大值: ${data.max}\n`;
                    if (data.bounds) info += `范围: [${data.bounds.join(', ')}]\n`;
                    if (data.resolution_deg) info += `分辨率: ${data.resolution_deg}°\n`;
                    if (data.is_simulated) info += `⚠️ 模拟数据（实际数据不存在）\n`;
                    if (data.grid) {
                        const gridPreview = data.grid.slice(0, 5).map(row => 
                            row.slice(0, 5).map(v => v.toFixed(2)).join(', ') + (row.length > 5 ? '...' : '')
                        );
                        info += `\n网格预览 (前5×5):\n${gridPreview.join('\n')}`;
                        info += `\n\n总网格: ${data.grid.length}×${data.grid[0]?.length || 0}`;
                    }
                    display.textContent = info;
                    container.classList.remove('hidden');
                    uiService.showToast('栅格数据查询成功', 'success');
                }
            } catch (err) {
                uiService.showToast(err.message, 'error');
            }
        });

        // =============================================================
        // ===== 新增：查询当前预警 =====
        // =============================================================
        document.getElementById('query-alert-btn')?.addEventListener('click', async () => {
            const regionId = document.getElementById('region-select')?.value;
            if (!regionId) {
                uiService.showToast('请先选择区域', 'error');
                return;
            }
            try {
                const result = await apiService.getCurrentAlert(parseInt(regionId));
                const display = document.getElementById('alert-data-display');
                const container = document.getElementById('alert-result');
                if (result.data) {
                    const data = result.data;
                    let info = `📋 预警信息\n`;
                    info += `━━━━━━━━━━━━━━━━━━━━\n`;
                    info += `预警级别: ${data.alert_level || '无'}\n`;
                    info += `预警类型: ${data.alert_type || '暂无'}\n`;
                    info += `描述: ${data.description || '当前气象条件未触发任何预警'}\n`;
                    if (data.triggered_value !== undefined) {
                        info += `触发值: ${data.triggered_value}\n`;
                    }
                    if (data.latest_time) {
                        info += `最新数据时间: ${new Date(data.latest_time).toLocaleString()}`;
                    }
                    display.textContent = info;
                    container.classList.remove('hidden');
                    
                    // 根据预警级别显示不同颜色提示
                    if (data.alert_level === '红色') {
                        uiService.showToast('⚠️ 红色预警！请立即采取防范措施！', 'error');
                    } else if (data.alert_level === '橙色') {
                        uiService.showToast('⚠️ 橙色预警，请注意防范', 'error');
                    } else if (data.alert_level === '黄色') {
                        uiService.showToast('黄色预警，请关注天气变化', 'success');
                    } else {
                        uiService.showToast('当前无预警', 'success');
                    }
                }
            } catch (err) {
                uiService.showToast(err.message, 'error');
            }
        });

        // =============================================================
        // ===== 新增：查询干旱指数 =====
        // =============================================================
        document.getElementById('query-drought-btn')?.addEventListener('click', async () => {
            const regionId = document.getElementById('region-select')?.value;
            if (!regionId) {
                uiService.showToast('请先选择区域', 'error');
                return;
            }
            try {
                const result = await apiService.getDroughtIndex(parseInt(regionId));
                const display = document.getElementById('alert-data-display');
                const container = document.getElementById('alert-result');
                if (result.data) {
                    const data = result.data;
                    let info = `🌵 干旱指数分析\n`;
                    info += `━━━━━━━━━━━━━━━━━━━━\n`;
                    info += `连续无降水天数: ${data.consecutive_dry_days || 0} 天\n`;
                    info += `干旱等级: ${data.drought_level || '无干旱'}\n`;
                    info += `参考周期: ${data.reference_days || 30} 天\n`;
                    if (data.latest_record_time) {
                        info += `最新数据时间: ${new Date(data.latest_record_time).toLocaleString()}`;
                    }
                    display.textContent = info;
                    container.classList.remove('hidden');
                    
                    if (data.drought_level === '重度干旱') {
                        uiService.showToast('⚠️ 重度干旱，需采取紧急措施', 'error');
                    } else if (data.drought_level === '中度干旱') {
                        uiService.showToast('中度干旱，注意水资源管理', 'error');
                    } else if (data.drought_level === '轻度干旱') {
                        uiService.showToast('轻度干旱，建议关注天气变化', 'success');
                    } else {
                        uiService.showToast('当前无干旱', 'success');
                    }
                }
            } catch (err) {
                uiService.showToast(err.message, 'error');
            }
        });

        // =============================================================
        // ===== 新增：地形统计分析 =====
        // =============================================================
        document.getElementById('query-terrain-btn')?.addEventListener('click', async () => {
            const regionId = document.getElementById('region-select')?.value;
            if (!regionId) {
                uiService.showToast('请先选择区域', 'error');
                return;
            }
            try {
                const result = await apiService.getTerrainAnalysis(parseInt(regionId));
                const display = document.getElementById('alert-data-display');
                const container = document.getElementById('alert-result');
                if (result.data) {
                    const data = result.data;
                    let info = `⛰️ 地形统计分析\n`;
                    info += `━━━━━━━━━━━━━━━━━━━━\n`;
                    info += `平均高程: ${data.mean_elevation?.toFixed(2) || 'N/A'} ${data.unit || 'm'}\n`;
                    info += `最低高程: ${data.min_elevation?.toFixed(2) || 'N/A'} ${data.unit || 'm'}\n`;
                    info += `最高高程: ${data.max_elevation?.toFixed(2) || 'N/A'} ${data.unit || 'm'}\n`;
                    if (data.mean_elevation && data.min_elevation && data.max_elevation) {
                        info += `高程差: ${(data.max_elevation - data.min_elevation).toFixed(2)} ${data.unit || 'm'}`;
                    }
                    display.textContent = info;
                    container.classList.remove('hidden');
                    uiService.showToast('地形分析完成', 'success');
                }
            } catch (err) {
                uiService.showToast(err.message, 'error');
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

            console.log('/weather 查询响应:', data);
            console.log('data.data:', data.data);
            console.log('data.data 类型:', Array.isArray(data.data) ? '数组' : typeof data.data);
            if (data.data) console.log('data.data.length:', data.data.length);

            if (data.data && data.data.length) {

                // 按时间戳升序排序
                data.data.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
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

                 // 按时间戳升序排序
                result.data.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

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
    },
    
    // 加载栅格数据关联区域下拉框
    async loadRasterRegionSelect() {
        try {
            const data = await apiService.getRegions();
            const select = document.getElementById('raster-region-id');
            if (select) {
                select.innerHTML = '<option value="">请选择区域</option>';
                if (data.data && data.data.length) {
                    data.data.forEach(region => {
                        const opt = document.createElement('option');
                        opt.value = region.id;
                        opt.textContent = `${region.name} (${region.code || '无编码'})`;
                        select.appendChild(opt);
                    });
                }
            }
        } catch (err) {
            console.error('加载区域列表失败', err);
        }
    }
};

// 仅在主页（包含 map-container 元素）时才执行主页初始化
if (document.getElementById('map-container')) {
    document.addEventListener('DOMContentLoaded', () => appController.init());
}
// 1. 本地预设坐标库（在这里新增城市）
const extraAreaCoord = {
    "重庆": { lng: 106.551614, lat: 29.563009 },
    "贵州": { lng: 106.630189, lat: 26.651517 },
    "贵阳": { lng: 106.630189, lat: 26.651517 },
    "四川": { lng: 104.066801, lat: 30.572816 },
    "成都": { lng: 104.066801, lat: 30.572816 },
    "云南": { lng: 102.712251, lat: 25.040609 },
    "昆明": { lng: 102.712251, lat: 25.040609 },
    "渝中区": { lng: 106.575, lat: 29.562 }
};

// 省份列表，用来区分缩放等级
const provinceNames = ["重庆", "贵州", "四川", "云南", "广西", "湖南"];

/**
 * 公共渲染点位函数 - 增加多层地图就绪校验，防止阻塞地图加载
 * @param {number} lng
 * @param {number} lat
 * @param {string} title
 */
function setMapMarker(lng, lat, title) {
    // 多层校验：地图服务、地图实例、高德API全部就绪才执行
    if (!uiService || !uiService.mapInstance || typeof AMap === 'undefined') {
        uiService.showError("地图尚未加载完成，请稍后重试");
        return;
    }
    const map = uiService.mapInstance;

    // 清除旧标记
    if (uiService.currentMarker) {
        map.remove(uiService.currentMarker);
    }

    // 移除外部图标，使用默认Marker，避免网络加载失败阻塞地图
    uiService.currentMarker = new AMap.Marker({
        position: [lng, lat],
        title: title,
        map: map
    });

    // 判断缩放层级
    const targetZoom = provinceNames.includes(title) ? 5 : 10;
    map.setZoomAndCenter(targetZoom, [lng, lat]);
    // 更新页面经纬度展示
    uiService.updatePositionDisplay(lng, lat);
}

// 劫持 区域名称搜索
const originSearchRegion = appController.searchRegionByName;
appController.searchRegionByName = async function (...args) {
    const nameRaw = document.getElementById('search-region-name')?.value || '';
    const name = nameRaw.trim();
    if (!name) return uiService.showError('请输入区域名称');

    // 执行原方法，透传所有参数
    await originSearchRegion.call(this, ...args);

    const resWrap = document.getElementById('region-detail-result');
    if (!resWrap) return;
    const resHtml = resWrap.innerHTML;

    // 后端无结果 且 存在本地坐标
    if (resHtml.includes("未找到该区域") && extraAreaCoord[name]) {
        const area = extraAreaCoord[name];
        resWrap.innerHTML = `
            <div class="bg-blue-50 p-3 rounded">
                <span class="text-red-500">[本地兜底数据]</span><br>
                名称: ${name}<br>
                纬度: ${area.lat}<br>
                经度: ${area.lng}
            </div>
        `;
        // 调用安全渲染方法
        setMapMarker(area.lng, area.lat, name);
    }
};

// 劫持 地图搜索框检索
const originDoSearch = uiService.doSearchPlace;
uiService.doSearchPlace = function (keyword) {
    const key = keyword.trim();
    // 优先匹配本地坐标
    if (extraAreaCoord[key]) {
        const area = extraAreaCoord[key];
        setMapMarker(area.lng, area.lat, key);
        uiService.showSuccess(`已定位到：${key}【本地预设坐标】`);
        return;
    }
    // 本地无匹配，执行原高德搜索逻辑
    originDoSearch.call(this, keyword);
};