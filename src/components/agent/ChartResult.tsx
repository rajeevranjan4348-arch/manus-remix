import React from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  ZAxis
} from 'recharts';

const MOCK_DATA = [
  { name: 'Jan', value: 400, other: 240, x: 100, y: 200, z: 200 },
  { name: 'Feb', value: 300, other: 139, x: 120, y: 100, z: 260 },
  { name: 'Mar', value: 200, other: 980, x: 170, y: 300, z: 400 },
  { name: 'Apr', value: 278, other: 390, x: 140, y: 250, z: 280 },
  { name: 'May', value: 189, other: 480, x: 150, y: 400, z: 500 },
  { name: 'Jun', value: 239, other: 380, x: 110, y: 280, z: 200 },
  { name: 'Jul', value: 349, other: 430, x: 130, y: 150, z: 300 },
];

const COLORS = ['#18181B', '#52525B', '#71717A', '#A1A1AA', '#D4D4D8', '#E4E4E7'];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const title = label || payload[0]?.name || payload[0]?.payload?.name || '';
    return (
      <div className="bg-white/95 dark:bg-card/95 backdrop-blur-sm border border-border p-3 rounded-xl shadow-lg text-xs z-50">
        {title && <p className="font-bold mb-2 text-foreground">{title}</p>}
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2 mb-1">
            <div 
              className="w-2.5 h-2.5 rounded-full shrink-0" 
              style={{ backgroundColor: entry.color || entry.fill || COLORS[index % COLORS.length] }}
            />
            <span className="text-muted-foreground capitalize">{entry.name || entry.dataKey || 'Value'}:</span>
            <span className="font-mono font-medium">{
              typeof entry.value === 'number' 
                ? entry.value.toLocaleString() 
                : (entry.value ?? 0)
            }</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export function ChartResult({ type, data }: { type: string, data?: any }) {
  // Process data from agent response - always use MOCK_DATA as baseline for visualization
  let chartData = MOCK_DATA;
  let chartKeys: string[] = [];

  // Handle nested data structure
  const rawData = data?.data || data;
  
  // Only override if we have valid data with proper structure
  if (rawData && rawData.labels && rawData.datasets && rawData.labels.length > 0) {
    try {
      // Convert from chart.js format to recharts format
      chartData = rawData.labels.map((label: string, i: number) => {
        const point: any = { name: label, x: i + 1 };
        
        rawData.datasets.forEach((dataset: any, dsIndex: number) => {
          const val = dataset.data?.[i] ?? 0;
          const key = dataset.label || `Series ${dsIndex + 1}`;
          point[key] = val;
          if (!chartKeys.includes(key)) chartKeys.push(key);
          
          // Map primary dataset to standard keys for different chart types
          if (dsIndex === 0) {
            point.value = val; // For Pie/Bar/Line generic fallback
            point.y = val;     // For Scatter/Bubble
            point.z = Math.abs(val) * 10; // For Bubble size (scaled)
          }
          // If there's a second dataset, use it for Z in bubble if available
          if (dsIndex === 1 && (type === 'bubble' || type === 'scatter')) {
            point.z = Math.abs(val);
          }
        });
        return point;
      });
    } catch (e) {
      console.warn('Failed to parse chart data, using mock data:', e);
      chartData = MOCK_DATA;
    }
  } else if (Array.isArray(rawData) && rawData.length > 0) {
    chartData = rawData;
  }
  
  // Ensure chartData is never empty
  if (!chartData || chartData.length === 0) {
    chartData = MOCK_DATA;
  }

  // If no explicit keys found (e.g. mock data or simple structure), try to infer
  if (chartKeys.length === 0) {
    if (chartData === MOCK_DATA) {
      chartKeys = ['value', 'other'];
    } else {
      // Find keys that are not 'name', 'x', 'y', 'z'
      const firstItem = chartData[0];
      if (firstItem) {
        chartKeys = Object.keys(firstItem).filter(k => 
          !['name', 'x', 'y', 'z', 'value'].includes(k)
        );
        // If no specific keys, assume 'value' is the main one
        if (chartKeys.length === 0 && 'value' in firstItem) {
          chartKeys = ['value'];
        }
      }
    }
  }

  const renderChart = () => {
    switch (type?.toLowerCase()) {
      case 'bar':
        return (
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E4E7" />
            <XAxis 
              dataKey="name" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 11, fill: '#71717A', fontFamily: 'var(--font-geist-mono)' }} 
              dy={10} 
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 11, fill: '#71717A', fontFamily: 'var(--font-geist-mono)' }} 
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F4F4F5' }} />
            {chartKeys.map((key, i) => (
              <Bar 
                key={key} 
                dataKey={key} 
                fill={COLORS[i % COLORS.length]} 
                radius={[4, 4, 0, 0]} 
                maxBarSize={60}
              />
            ))}
            {/* Fallback if no keys found */}
            {chartKeys.length === 0 && <Bar dataKey="value" fill={COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={60} />}
          </BarChart>
        );
      case 'line':
        return (
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E4E7" />
            <XAxis 
              dataKey="name" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 11, fill: '#71717A', fontFamily: 'var(--font-geist-mono)' }} 
              dy={10} 
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 11, fill: '#71717A', fontFamily: 'var(--font-geist-mono)' }} 
            />
            <Tooltip content={<CustomTooltip />} />
            {chartKeys.map((key, i) => (
              <Line 
                key={key} 
                type="monotone" 
                dataKey={key} 
                stroke={COLORS[i % COLORS.length]} 
                strokeWidth={2} 
                dot={{ r: 0, fill: COLORS[i % COLORS.length], strokeWidth: 0 }} 
                activeDot={{ r: 6, strokeWidth: 0 }}
              />
            ))}
            {chartKeys.length === 0 && (
              <Line type="monotone" dataKey="value" stroke={COLORS[0]} strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
            )}
          </LineChart>
        );
      case 'pie':
        return (
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={110}
              paddingAngle={3}
              dataKey={chartKeys[0] || "value"}
              nameKey="name"
              stroke="none"
            >
              {chartData.map((entry: any, index: number) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        );
      case 'scatter':
      case 'bubble':
        return (
          <ScatterChart margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E4E7" />
            <XAxis 
              dataKey="x" 
              type="number" 
              name="x" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 11, fill: '#71717A', fontFamily: 'var(--font-geist-mono)' }} 
              dy={10} 
            />
            <YAxis 
              dataKey="y" 
              type="number" 
              name="y" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 11, fill: '#71717A', fontFamily: 'var(--font-geist-mono)' }} 
            />
            {type === 'bubble' && <ZAxis dataKey="z" range={[60, 400]} name="size" />}
            <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<CustomTooltip />} />
            <Scatter name="Data" data={chartData} fill={COLORS[0]} />
          </ScatterChart>
        );
      case 'area':
      case 'heatmap':
        return (
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E4E7" />
            <XAxis 
              dataKey="name" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 11, fill: '#71717A', fontFamily: 'var(--font-geist-mono)' }} 
              dy={10} 
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 11, fill: '#71717A', fontFamily: 'var(--font-geist-mono)' }} 
            />
            <Tooltip content={<CustomTooltip />} />
            {chartKeys.map((key, i) => (
              <Area 
                key={key} 
                type="monotone" 
                dataKey={key} 
                stroke={COLORS[i % COLORS.length]} 
                fill={COLORS[i % COLORS.length]} 
                fillOpacity={0.1} 
              />
            ))}
            {chartKeys.length === 0 && (
               <Area type="monotone" dataKey="value" stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.1} />
            )}
          </AreaChart>
        );
      default:
        // Default to Bar chart if unknown type
        return (
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
             <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E4E7" />
             <XAxis 
               dataKey="name" 
               axisLine={false} 
               tickLine={false} 
               tick={{ fontSize: 11, fill: '#71717A', fontFamily: 'var(--font-geist-mono)' }} 
               dy={10} 
             />
             <YAxis 
               axisLine={false} 
               tickLine={false} 
               tick={{ fontSize: 11, fill: '#71717A', fontFamily: 'var(--font-geist-mono)' }} 
             />
             <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F4F4F5' }} />
             <Bar dataKey="value" fill={COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={60} />
          </BarChart>
        );
    }
  };

  return (
    <div className="w-full h-full relative" style={{ minHeight: 300 }}>
      <div className="absolute inset-0">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
