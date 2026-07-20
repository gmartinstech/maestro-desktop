import React from 'react';
import { WeatherWidget as AnimatedWeatherWidget } from '@toolui/components/weather-widget/weather-widget-container';
import type { WeatherConditionCode, ForecastDay } from '@toolui/components/weather-widget/schema-runtime';
import { useThemeMode } from '@/shared/styles/ThemeContext';
import type { WeatherProps } from './showUiPayload';

function toConditionCode(condition: string | undefined): WeatherConditionCode {
  const cond = (condition || '').toLowerCase();
  if (/thunder|storm/.test(cond)) return 'thunderstorm';
  if (/heavy rain|downpour/.test(cond)) return 'heavy-rain';
  if (/drizzle/.test(cond)) return 'drizzle';
  if (/rain|shower/.test(cond)) return 'rain';
  if (/sleet/.test(cond)) return 'sleet';
  if (/hail/.test(cond)) return 'hail';
  if (/snow/.test(cond)) return 'snow';
  if (/fog|mist|haze/.test(cond)) return 'fog';
  if (/overcast/.test(cond)) return 'overcast';
  if (/partly|part sun|some cloud/.test(cond)) return 'partly-cloudy';
  if (/cloud/.test(cond)) return 'cloudy';
  if (/wind/.test(cond)) return 'windy';
  return 'clear';
}

/** Agent-facing 'weather' shape adapted onto the vendored animated (WebGL) weather widget. */
function WeatherWidget({ props }: { props: WeatherProps }): React.ReactElement {
  const { mode } = useThemeMode();
  const forecast: ForecastDay[] = (props.forecast || []).slice(0, 7).map((d) => ({
    label: d.day,
    conditionCode: toConditionCode(d.condition),
    tempMin: Math.round(d.low ?? d.high - 8),
    tempMax: Math.round(d.high),
  }));

  return (
    <div className={`tool-ui-scope${mode === 'dark' ? ' dark' : ''}`} style={{ width: 320 }}>
      <AnimatedWeatherWidget
        version="3.1"
        id={`weather-${props.location}`}
        location={{ name: props.location }}
        units={{ temperature: props.unit === 'C' ? 'celsius' : 'fahrenheit' }}
        current={{
          conditionCode: toConditionCode(props.condition),
          temperature: Math.round(props.temp),
          tempMin: Math.round(props.low ?? props.temp - 4),
          tempMax: Math.round(props.high ?? props.temp + 4),
        }}
        forecast={forecast}
        time={{ localTimeOfDay: new Date().getHours() + new Date().getMinutes() / 60 }}
        effects={{ enabled: true, quality: 'auto' }}
      />
    </div>
  );
}

export default WeatherWidget;
